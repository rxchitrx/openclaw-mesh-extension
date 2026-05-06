import type { CRDTService, Delta } from "./crdt.js";
import type { PeerInfo } from "./discovery.js";
import type { TrackedFile } from "./file-watcher.js";

export type TransportConfig = {
  nodeName: string;
  port: number;
  crdt: CRDTService;
  logger: any;
};

export type Connection = {
  peerName: string;
  socket: any;
  isAlive: boolean;
  approved: boolean;
  manifest?: TrackedFile[];
};

export type PendingConnection = {
  peerName: string;
  socket: any;
  host: string;
  connectedAt: number;
};

export type TransportNotification = {
  type: "peer_pending" | "peer_approved" | "peer_denied" | "peer_disconnected" | "file_deleted" | "conflict" | "manifest_received";
  message: string;
  peerName?: string;
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
};

export function createTransport(config: TransportConfig): TransportService {
  const { nodeName, port, crdt, logger } = config;

  const connections = new Map<string, Connection>();
  const pendingConnections = new Map<string, PendingConnection>();
  const remoteManifests = new Map<string, TrackedFile[]>();
  const approvedPeers = new Set<string>();
  let server: any = null;
  let notificationHandler: ((notification: TransportNotification) => void) | null = null;

  const notify = (notification: TransportNotification) => {
    if (notificationHandler) {
      notificationHandler(notification);
    }
  };

  const handleMessage = (peerName: string, data: string, approved: boolean) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "delta":
          if (!approved) return;
          crdt.applyRemoteDelta(message.delta, message.file);
          break;

        case "sync_request":
          if (!approved) return;
          {
            const state = crdt.getState(message.file);
            sendToPeer(peerName, {
              type: "sync_response",
              file: message.file,
              state,
            });
          }
          break;

        case "sync_response":
          if (!approved) return;
          crdt.mergeState(message.state, message.file);
          break;

        case "approval_request":
          {
            const pending = pendingConnections.get(peerName);
            if (pending) {
              logger.info(`Approval request from: ${peerName}`);
              notify({
                type: "peer_pending",
                message: `Peer '${peerName}' wants to join the mesh. Say 'approve ${peerName}' or 'deny ${peerName}'.`,
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
            const manifestCb = message._manifestCallback;
            if (manifestCb) manifestCb();
          }
          break;

        case "file_content":
          if (!approved) return;
          {
            const { path: filePath, content, isBinary } = message;
            if (isBinary) {
              crdt.applyLocalChange(filePath, content);
              logger.info(`Received binary file: ${filePath} from ${peerName}`);
            } else {
              const delta = crdt.applyLocalChange(filePath, content);
              if (delta) {
                const localContent = crdt.getFileContent(filePath);
                if (localContent !== null && localContent !== content) {
                  notify({
                    type: "conflict",
                    message: `Conflict: both you and '${peerName}' edited '${filePath}'. CRDT merged — you may want to review.`,
                    peerName,
                    data: { file: filePath },
                  });
                }
              }
              logger.info(`Received file: ${filePath} from ${peerName}`);
            }
          }
          break;

        case "file_content_request":
          if (!approved) return;
          {
            const manifestCb2 = message._contentCallback;
            if (manifestCb2) manifestCb2(message.path);
          }
          break;

        case "file_deleted":
          if (!approved) return;
          notify({
            type: "file_deleted",
            message: `Peer '${peerName}' deleted '${message.path}'. Keep your copy or say 'delete ${message.path} locally'.`,
            peerName,
            data: { path: message.path },
          });
          break;

        default:
          logger.warn(`Unknown message type from ${peerName}: ${message.type}`);
      }
    } catch (err) {
      logger.error(`Failed to handle message from ${peerName}: ${err}`);
    }
  };

  const sendToPeer = (peerName: string, message: any) => {
    const conn = connections.get(peerName);
    if (conn && conn.socket.readyState === 1) {
      conn.socket.send(JSON.stringify(message));
    }
  };

  const setupSocket = (socket: any, peerName: string, isIncoming: boolean) => {
    socket.on("message", (data: Buffer) => {
      const pending = pendingConnections.get(peerName);
      if (pending) {
        handleMessage(peerName, data.toString(), false);
      } else {
        const conn = connections.get(peerName);
        if (conn && conn.approved) {
          handleMessage(peerName, data.toString(), true);
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
              message: `Peer '${peerName}' from ${host} wants to join the mesh. Say 'approve ${peerName}' or 'deny ${peerName}'.`,
              peerName,
            });
          }
        });

        logger.info(`Mesh transport server started on port ${port}`);
      } catch (err) {
        logger.error(`Failed to start transport server: ${err}`);
        throw err;
      }
    },

    async stop() {
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
        message: `Approved peer '${peerName}'. Manifest will be exchanged.`,
        peerName,
      });

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
      sendToPeer(peerName, { type: "manifest_request" });
    },

    sendFileContent(peerName: string, relativePath: string, content: string, isBinary: boolean) {
      sendToPeer(peerName, {
        type: "file_content",
        path: relativePath,
        content,
        isBinary,
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
  };
}
