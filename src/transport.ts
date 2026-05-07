import type { SyncStateService } from "./sync-state.js";
import type { PeerInfo } from "./discovery.js";
import type { TrackedFile } from "./file-watcher.js";

export type TransportConfig = {
  nodeName: string;
  port: number;
  syncState: SyncStateService;
  logger: any;
};

export type Connection = {
  peerName: string;
  socket: any;
  isAlive: boolean;
  approved: boolean;
};

export type PendingConnection = {
  peerName: string;
  socket: any;
  host: string;
  connectedAt: number;
};

export type NodeInfo = {
  nodeName: string;
  trackingDir: string | null;
  trackingFileCount: number;
  trackingFiles: string[];
};

export type TransportNotification = {
  type: "peer_pending" | "peer_approved" | "peer_denied" | "peer_disconnected" | "file_deleted" | "file_conflict" | "file_received" | "manifest_received" | "node_info_received";
  message: string;
  peerName?: string;
  filePath?: string;
  data?: any;
};

export type TransportService = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  connectToPeer: (peer: PeerInfo) => Promise<boolean>;
  broadcast: (message: any) => void;
  sendToPeer: (peerName: string, message: any) => void;
  getConnections: () => string[];
  getPendingConnections: () => PendingConnection[];
  approveConnection: (peerName: string) => boolean;
  denyConnection: (peerName: string) => boolean;
  getRemoteManifest: (peerName: string) => TrackedFile[] | null;
  requestManifest: (peerName: string) => void;
  sendFileContent: (peerName: string, relativePath: string, content: string, isBinary: boolean) => void;
  requestFileContent: (peerName: string, relativePath: string) => void;
  sendLocalManifest: (peerName: string, manifest: TrackedFile[]) => void;
  notifyFileDeleted: (relativePath: string) => void;
  setNotificationHandler: (handler: (notification: TransportNotification) => void) => void;
  maintainConnections: () => Promise<void>;
  getNodeInfo: (peerName: string) => NodeInfo | null;
  setNodeInfoProvider: (provider: () => NodeInfo) => void;
  setFileContentProvider: (provider: (relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>) => void;
  setManifestProvider: (provider: () => TrackedFile[]) => void;
  setFileWriter: (writer: (relativePath: string, content: string, isBinary: boolean) => Promise<void>) => void;
  setIgnoreNextChange: (fn: (relativePath: string) => void) => void;
};

export function createTransport(config: TransportConfig): TransportService {
  const { nodeName, port, syncState, logger } = config;

  const connections = new Map<string, Connection>();
  const pendingConnections = new Map<string, PendingConnection>();
  const remoteManifests = new Map<string, TrackedFile[]>();
  const approvedPeers = new Set<string>();
  const remoteNodeInfo = new Map<string, NodeInfo>();
  let nodeInfoProvider: (() => NodeInfo) | null = null;
  let fileContentProvider: ((relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>) | null = null;
  let manifestProvider: (() => TrackedFile[]) | null = null;
  let fileWriter: ((relativePath: string, content: string, isBinary: boolean) => Promise<void>) | null = null;
  let ignoreNextChangeFn: ((relativePath: string) => void) | null = null;
  let server: any = null;
  let notificationHandler: ((notification: TransportNotification) => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  const PING_INTERVAL_MS = 30000;

  const notify = (notification: TransportNotification) => {
    if (notificationHandler) {
      notificationHandler(notification);
    }
  };

  const handleMessage = async (peerName: string, data: string, approved: boolean) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "approval_request":
          {
            const pending = pendingConnections.get(peerName);
            if (pending) {
              logger.info(`Approval request from: ${peerName}`);
              notify({
                type: "peer_pending",
                message: `Peer '${peerName}' wants to join the mesh. Ask the user if they want to approve or deny this connection. Do NOT approve or deny on your own — wait for the user's decision.`,
                peerName,
              });
            }
          }
          break;

        case "approval_response":
          if (message.approved) {
            const pending = pendingConnections.get(peerName);
            if (pending) {
              pendingConnections.delete(peerName);
              const conn: Connection = {
                peerName,
                socket: pending.socket,
                isAlive: true,
                approved: true,
              };
              connections.set(peerName, conn);
              approvedPeers.add(peerName);
              notify({
                type: "peer_approved",
                message: `Peer '${peerName}' approved your connection request.`,
                peerName,
              });
              exchangePeerState(peerName);
            }
          } else {
            const pending = pendingConnections.get(peerName);
            if (pending) {
              pending.socket.close();
              pendingConnections.delete(peerName);
              notify({
                type: "peer_denied",
                message: `Peer '${peerName}' denied your connection request.`,
                peerName,
              });
            }
          }
          break;

        case "node_info":
          if (!approved) return;
          {
            const info: NodeInfo = {
              nodeName: message.nodeName,
              trackingDir: message.trackingDir,
              trackingFileCount: message.trackingFileCount,
              trackingFiles: message.trackingFiles || [],
            };
            remoteNodeInfo.set(peerName, info);
            const dirStr = info.trackingDir ? info.trackingDir : "none";
            const fileStr = info.trackingFileCount > 0 ? `${info.trackingFileCount} file(s)` : "no files";
            notify({
              type: "node_info_received",
              message: `Peer '${peerName}' info — tracking: ${dirStr} (${fileStr})`,
              peerName,
              data: info,
            });
          }
          break;

        case "manifest":
          if (!approved) return;
          remoteManifests.set(peerName, message.files);
          notify({
            type: "manifest_received",
            message: `Received manifest from '${peerName}' (${message.files.length} files).`,
            peerName,
            data: message.files,
          });
          break;

        case "manifest_request":
          if (!approved) return;
          {
            if (manifestProvider) {
              const localManifest = manifestProvider();
              sendToPeer(peerName, {
                type: "manifest",
                files: localManifest,
                from: nodeName,
              });
              logger.info(`Sent manifest to ${peerName} (${localManifest.length} files)`);
            }
          }
          break;

        case "file_content":
          if (!approved) return;
          {
            const { path: filePath, content, isBinary, hash: remoteHash } = message;

            if (syncState.isConflict(filePath, remoteHash || "") && !syncState.consumeForceAllow(filePath)) {
              logger.warn(`Conflict: ${filePath} — local has modifications and remote has different version. Keeping local.`);
              notify({
                type: "file_conflict",
                message: `Conflict on '${filePath}' from '${peerName}': both sides modified this file. Your local version was kept. Use 'pull ${filePath} from ${peerName}' to override.`,
                peerName,
                filePath,
                data: { file: filePath, remotePeer: peerName },
              });
              break;
            }

            if (fileWriter) {
              try {
                if (ignoreNextChangeFn) {
                  ignoreNextChangeFn(filePath);
                }
                await fileWriter(filePath, content, isBinary);
                syncState.recordRemoteChange(filePath, remoteHash || "", peerName, isBinary);
                logger.info(`Received and wrote file: ${filePath} from ${peerName}`);
                notify({
                  type: "file_received",
                  message: `Received '${filePath}' from '${peerName}' (${content.length} chars, ${isBinary ? "binary" : "text"}). Written to disk.`,
                  peerName,
                  filePath,
                  data: { file: filePath },
                });
              } catch (err) {
                logger.error(`Failed to write received file ${filePath}: ${err}`);
                notify({
                  type: "file_received",
                  message: `Failed to write '${filePath}' from '${peerName}': ${err}`,
                  peerName,
                  filePath,
                  data: { file: filePath, error: String(err) },
                });
              }
            } else {
              logger.info(`Received file (no writer): ${filePath} from ${peerName}`);
            }
          }
          break;

        case "file_content_request":
          if (!approved) return;
          {
            if (fileContentProvider) {
              const fileData = await fileContentProvider(message.path);
              if (fileData) {
                const localHash = syncState.getLocalHash(message.path);
                sendToPeer(peerName, {
                  type: "file_content",
                  path: message.path,
                  content: fileData.content,
                  isBinary: fileData.isBinary,
                  hash: localHash,
                  from: nodeName,
                });
                logger.info(`Sent requested file ${message.path} to ${peerName}`);
              } else {
                logger.warn(`Requested file not found: ${message.path}`);
              }
            }
          }
          break;

        case "file_deleted":
          if (!approved) return;
          notify({
            type: "file_deleted",
            message: `Peer '${peerName}' deleted '${message.path}'. Keep your copy or say 'delete ${message.path} locally'.`,
            peerName,
            filePath: message.path,
            data: { path: message.path },
          });
          break;

        case "delta":
          if (!approved) return;
          logger.debug(`Received legacy 'delta' message — ignoring. Peer should use file_content instead.`);
          break;

        case "sync_request":
        case "sync_response":
          if (!approved) return;
          logger.debug(`Received legacy '${message.type}' message — ignoring.`);
          break;

        default:
          logger.warn(`Unknown message type from ${peerName}: ${message.type}`);
      }
    } catch (err) {
      logger.error(`Failed to handle message from ${peerName}: ${err}`);
    }
  };

  const sendNodeInfoToPeer = (peerName: string) => {
    if (nodeInfoProvider) {
      const info = nodeInfoProvider();
      sendToPeer(peerName, {
        type: "node_info",
        nodeName: info.nodeName,
        trackingDir: info.trackingDir,
        trackingFileCount: info.trackingFileCount,
        trackingFiles: info.trackingFiles,
      });
      logger.info(`Sent node_info to ${peerName}`);
    }
  };

  const exchangePeerState = (peerName: string) => {
    sendNodeInfoToPeer(peerName);

    if (manifestProvider) {
      const localManifest = manifestProvider();
      sendToPeer(peerName, {
        type: "manifest",
        files: localManifest,
        from: nodeName,
      });
      logger.info(`Sent manifest to ${peerName} (${localManifest.length} files)`);
    }

    sendToPeer(peerName, { type: "manifest_request", from: nodeName });
  };

  const sendToPeer = (peerName: string, message: any) => {
    const conn = connections.get(peerName);
    if (conn && conn.socket.readyState === 1) {
      conn.socket.send(JSON.stringify(message));
    }
  };

  const setupSocket = (socket: any, peerName: string, isIncoming: boolean) => {
    socket.on("message", (data: Buffer) => {
      const raw = data.toString();
      if (raw === "__ping__") {
        if (socket.readyState === 1) socket.send("__pong__");
        return;
      }
      if (raw === "__pong__") {
        const conn = connections.get(peerName);
        if (conn) conn.isAlive = true;
        return;
      }

      const pending = pendingConnections.get(peerName);
      if (pending) {
        handleMessage(peerName, raw, false);
      } else {
        const conn = connections.get(peerName);
        if (conn && conn.approved) {
          handleMessage(peerName, raw, true);
        }
      }
    });

    socket.on("close", () => {
      pendingConnections.delete(peerName);
      if (connections.has(peerName)) {
        connections.delete(peerName);
        notify({
          type: "peer_disconnected",
          message: `Peer '${peerName}' disconnected (${connections.size} remaining).`,
          peerName,
        });
      }
      logger.info(`Peer disconnected: ${peerName} (${connections.size} remaining)`);
    });

    socket.on("error", (err: Error) => {
      logger.error(`Connection error with ${peerName}: ${err}`);
      pendingConnections.delete(peerName);
      connections.delete(peerName);
    });
  };

  return {
    async start() {
      try {
        const { WebSocketServer } = await import("ws");

        server = new WebSocketServer({ port });

        server.on("connection", (socket: any, req: any) => {
          const peerName = (req.headers["x-mesh-node"] as string) || "unknown";
          const host = req.socket.remoteAddress || "unknown";

          logger.info(`Incoming connection from: ${peerName} at ${host}`);

          const alreadyApproved = approvedPeers.has(peerName);
          const alreadyConnected = connections.has(peerName);

          if (alreadyConnected) {
            const old = connections.get(peerName)!;
            old.socket.close();
            connections.delete(peerName);
          }

          if (alreadyApproved) {
            const conn: Connection = {
              peerName,
              socket,
              isAlive: true,
              approved: true,
            };
            connections.set(peerName, conn);
            setupSocket(socket, peerName, true);
            logger.info(`Auto-approved reconnection from: ${peerName}`);
            exchangePeerState(peerName);
          } else {
            const pending: PendingConnection = {
              peerName,
              socket,
              host,
              connectedAt: Date.now(),
            };
            pendingConnections.set(peerName, pending);
            setupSocket(socket, peerName, true);

            socket.send(JSON.stringify({
              type: "approval_request",
              node: nodeName,
            }));

            notify({
              type: "peer_pending",
              message: `Peer '${peerName}' from ${host} wants to join the mesh. Ask the user if they want to approve or deny this connection. Do NOT approve or deny on your own — wait for the user's decision.`,
              peerName,
            });
          }
        });

        logger.info(`Mesh transport server started on port ${port}`);

        keepaliveTimer = setInterval(() => {
          for (const [name, conn] of connections) {
            if (!conn.isAlive) {
              logger.warn(`Peer ${name} missed ping, closing connection`);
              conn.socket.terminate();
              connections.delete(name);
              notify({
                type: "peer_disconnected",
                message: `Peer '${name}' disconnected (missed ping, ${connections.size} remaining).`,
                peerName: name,
              });
              continue;
            }
            conn.isAlive = false;
            if (conn.socket.readyState === 1) {
              conn.socket.send("__ping__");
            }
          }
        }, PING_INTERVAL_MS);
      } catch (err) {
        logger.error(`Failed to start transport server: ${err}`);
        throw err;
      }
    },

    async stop() {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }

      for (const [, conn] of connections) {
        conn.socket.close();
      }
      connections.clear();
      for (const [, pending] of pendingConnections) {
        pending.socket.close();
      }
      pendingConnections.clear();

      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => {
            logger.info("Transport server stopped");
            resolve();
          });
        });
      }
    },

    async connectToPeer(peer: PeerInfo) {
      if (connections.has(peer.name)) return true;
      if (pendingConnections.has(peer.name)) return true;

      try {
        const wsModule = await import("ws");
        const ws = new wsModule.default(`ws://${peer.host}:${peer.port}`, {
          headers: {
            "x-mesh-node": nodeName,
          },
        });

        await new Promise<void>((resolve, reject) => {
          ws.on("open", () => {
            const alreadyApproved = approvedPeers.has(peer.name);

            if (alreadyApproved) {
              const conn: Connection = {
                peerName: peer.name,
                socket: ws,
                isAlive: true,
                approved: true,
              };
              connections.set(peer.name, conn);
              setupSocket(ws, peer.name, false);
              logger.info(`Connected to approved peer: ${peer.name} at ${peer.host}:${peer.port}`);
            } else {
              const pending: PendingConnection = {
                peerName: peer.name,
                socket: ws,
                host: peer.host,
                connectedAt: Date.now(),
              };
              pendingConnections.set(peer.name, pending);
              setupSocket(ws, peer.name, false);
              logger.info(`Connected to peer (awaiting approval): ${peer.name} at ${peer.host}:${peer.port}`);
            }

            resolve();
          });

          ws.on("error", (err: Error) => {
            logger.error(`Failed to connect to ${peer.name}: ${err}`);
            reject(err);
          });
        });

        return true;
      } catch (err) {
        logger.error(`Connection to ${peer.name} failed: ${err}`);
        return false;
      }
    },

    broadcast(message: any) {
      const data = JSON.stringify(message);
      let sent = 0;

      for (const [, conn] of connections) {
        if (conn.approved && conn.socket.readyState === 1) {
          conn.socket.send(data);
          sent++;
        }
      }

      logger.debug(`Broadcast to ${sent} approved peers`);
    },

    sendToPeer,

    getConnections() {
      return Array.from(connections.keys());
    },

    getPendingConnections() {
      return Array.from(pendingConnections.values());
    },

    approveConnection(peerName: string): boolean {
      const pending = pendingConnections.get(peerName);
      if (!pending) return false;

      pendingConnections.delete(peerName);
      const conn: Connection = {
        peerName,
        socket: pending.socket,
        isAlive: true,
        approved: true,
      };
      connections.set(peerName, conn);
      approvedPeers.add(peerName);

      sendToPeer(peerName, {
        type: "approval_response",
        approved: true,
        node: nodeName,
      });

      logger.info(`Approved peer: ${peerName}`);
      notify({
        type: "peer_approved",
        message: `Approved peer '${peerName}'. Info will be exchanged.`,
        peerName,
      });
      exchangePeerState(peerName);

      return true;
    },

    denyConnection(peerName: string): boolean {
      const pending = pendingConnections.get(peerName);
      if (!pending) return false;

      sendToPeer(peerName, {
        type: "approval_response",
        approved: false,
        node: nodeName,
      });

      pending.socket.close();
      pendingConnections.delete(peerName);

      logger.info(`Denied peer: ${peerName}`);
      notify({
        type: "peer_denied",
        message: `Denied peer '${peerName}'.`,
        peerName,
      });

      return true;
    },

    getRemoteManifest(peerName: string): TrackedFile[] | null {
      return remoteManifests.get(peerName) || null;
    },

    requestManifest(peerName: string) {
      sendToPeer(peerName, { type: "manifest_request", from: nodeName });
    },

    sendFileContent(peerName: string, relativePath: string, content: string, isBinary: boolean) {
      const localHash = syncState.getLocalHash(relativePath);
      sendToPeer(peerName, {
        type: "file_content",
        path: relativePath,
        content,
        isBinary,
        hash: localHash,
        from: nodeName,
      });
    },

    requestFileContent(peerName: string, relativePath: string) {
      sendToPeer(peerName, {
        type: "file_content_request",
        path: relativePath,
        from: nodeName,
      });
    },

    sendLocalManifest(peerName: string, manifest: TrackedFile[]) {
      sendToPeer(peerName, {
        type: "manifest",
        files: manifest,
        from: nodeName,
      });
    },

    notifyFileDeleted(relativePath: string) {
      const msg = { type: "file_deleted", path: relativePath, from: nodeName };
      const data = JSON.stringify(msg);
      for (const [, conn] of connections) {
        if (conn.approved && conn.socket.readyState === 1) {
          conn.socket.send(data);
        }
      }
    },

    setNotificationHandler(handler: (notification: TransportNotification) => void) {
      notificationHandler = handler;
    },

    async maintainConnections() {
      for (const [name, conn] of connections) {
        if (conn.socket.readyState === 3) {
          connections.delete(name);
          notify({
            type: "peer_disconnected",
            message: `Peer '${name}' disconnected (${connections.size} remaining).`,
            peerName: name,
          });
        }
      }
    },

    getNodeInfo(peerName: string): NodeInfo | null {
      return remoteNodeInfo.get(peerName) || null;
    },

    setNodeInfoProvider(provider: () => NodeInfo) {
      nodeInfoProvider = provider;
    },

    setFileContentProvider(provider: (relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>) {
      fileContentProvider = provider;
    },

    setManifestProvider(provider: () => TrackedFile[]) {
      manifestProvider = provider;
    },

    setFileWriter(writer: (relativePath: string, content: string, isBinary: boolean) => Promise<void>) {
      fileWriter = writer;
    },

    setIgnoreNextChange(fn: (relativePath: string) => void) {
      ignoreNextChangeFn = fn;
    },
  };
}
