import { createHash } from "crypto";

import type { CRDTService } from "./crdt.js";
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

export type NodeInfo = {
  nodeName: string;
  trackingDir: string | null;
  trackingFileCount: number;
  trackingFiles: string[];
};

export type RemoteAppliedFile = {
  path: string;
  hash: string;
  appliedAt: number;
};

export type TransportNotification =
  | {
      type:
        | "peer_pending"
        | "peer_approved"
        | "peer_denied"
        | "peer_connected"
        | "peer_disconnected"
        | "conflict"
        | "manifest_received"
        | "node_info_received"
        | "sync_requested"
        | "sync_failed"
        | "sync_applied"
        | "file_sent"
        | "file_received"
        | "file_written"
        | "file_deleted";
      message: string;
      peerName?: string;
      filePath?: string;
      data?: Record<string, unknown>;
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
  getRemoteAppliedFiles: (peerName: string) => RemoteAppliedFile[];
  getRecentDisconnects: () => Array<{ peerName: string; reason: string; at: number }>;
};

function hashContent(content: string, isBinary: boolean): string {
  return createHash("sha1").update(content).update(isBinary ? ":binary" : ":text").digest("hex");
}

export function createTransport(config: TransportConfig): TransportService {
  const { nodeName, port, crdt, logger } = config;

  const connections = new Map<string, Connection>();
  const pendingConnections = new Map<string, PendingConnection>();
  const remoteManifests = new Map<string, TrackedFile[]>();
  const approvedPeers = new Set<string>();
  const remoteNodeInfo = new Map<string, NodeInfo>();
  const remoteAppliedFiles = new Map<string, Map<string, RemoteAppliedFile>>();
  const recentDisconnects: Array<{ peerName: string; reason: string; at: number }> = [];
  let nodeInfoProvider: (() => NodeInfo) | null = null;
  let fileContentProvider: ((relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>) | null = null;
  let manifestProvider: (() => TrackedFile[]) | null = null;
  let fileWriter: ((relativePath: string, content: string, isBinary: boolean) => Promise<void>) | null = null;
  let server: any = null;
  let notificationHandler: ((notification: TransportNotification) => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  const PING_INTERVAL_MS = 30000;
  const sentFileHashes = new Map<string, Map<string, string>>();

  const notify = (notification: TransportNotification) => {
    notificationHandler?.(notification);
  };

  const rememberDisconnect = (peerName: string, reason: string) => {
    recentDisconnects.unshift({ peerName, reason, at: Date.now() });
    while (recentDisconnects.length > 20) {
      recentDisconnects.pop();
    }
  };

  const setSentFileHash = (peerName: string, path: string, hash: string) => {
    const perPeer = sentFileHashes.get(peerName) ?? new Map<string, string>();
    perPeer.set(path, hash);
    sentFileHashes.set(peerName, perPeer);
  };

  const setRemoteAppliedFile = (peerName: string, path: string, hash: string, appliedAt: number) => {
    const perPeer = remoteAppliedFiles.get(peerName) ?? new Map<string, RemoteAppliedFile>();
    perPeer.set(path, { path, hash, appliedAt });
    remoteAppliedFiles.set(peerName, perPeer);
  };

  const sendNodeInfoToPeer = (peerName: string) => {
    if (!nodeInfoProvider) return;
    const info = nodeInfoProvider();
    sendToPeer(peerName, {
      type: "node_info",
      nodeName: info.nodeName,
      trackingDir: info.trackingDir,
      trackingFileCount: info.trackingFileCount,
      trackingFiles: info.trackingFiles,
    });
    logger.info(`Sent node_info to ${peerName}`);
  };

  const sendToPeer = (peerName: string, message: any) => {
    const conn = connections.get(peerName);
    if (conn && conn.socket.readyState === 1) {
      conn.socket.send(JSON.stringify(message));
    }
  };

  const finalizeApprovedConnection = (peerName: string, socket: any, host?: string) => {
    const conn: Connection = {
      peerName,
      socket,
      isAlive: true,
      approved: true,
    };
    connections.set(peerName, conn);
    approvedPeers.add(peerName);
    notify({
      type: "peer_connected",
      peerName,
      message: `Peer '${peerName}' is connected and approved.`,
      data: host ? { host } : undefined,
    });
    sendNodeInfoToPeer(peerName);
    if (manifestProvider) {
      sendToPeer(peerName, {
        type: "manifest",
        files: manifestProvider(),
        from: nodeName,
      });
    }
    sendToPeer(peerName, { type: "manifest_request", from: nodeName });
  };

  const closePeer = (peerName: string, reason: string) => {
    const pending = pendingConnections.get(peerName);
    if (pending) {
      pendingConnections.delete(peerName);
      try {
        pending.socket.close();
      } catch {}
    }

    const conn = connections.get(peerName);
    if (conn) {
      connections.delete(peerName);
      try {
        conn.socket.close();
      } catch {}
      rememberDisconnect(peerName, reason);
      notify({
        type: "peer_disconnected",
        peerName,
        message: `Peer '${peerName}' disconnected (${reason}).`,
        data: { reason },
      });
    }
  };

  const handleMessage = async (peerName: string, raw: string, approved: boolean) => {
    try {
      const message = JSON.parse(raw);

      switch (message.type) {
        case "delta":
          if (!approved) return;
          crdt.applyRemoteDelta(message.delta, message.file);
          break;

        case "sync_request":
          if (!approved) return;
          sendToPeer(peerName, {
            type: "sync_response",
            file: message.file,
            state: crdt.getState(message.file),
          });
          notify({
            type: "sync_requested",
            peerName,
            filePath: message.file,
            message: `Peer '${peerName}' requested sync state for '${message.file}'.`,
            data: { file: message.file },
          });
          break;

        case "sync_response":
          if (!approved) return;
          crdt.mergeState(message.state, message.file);
          break;

        case "approval_request": {
          const pending = pendingConnections.get(peerName);
          if (!pending) return;
          notify({
            type: "peer_pending",
            message: `Peer '${peerName}' wants to join the mesh. Ask the user if they want to approve or deny this connection. Do NOT approve or deny on your own — wait for the user's decision.`,
            peerName,
            data: { host: pending.host, connectedAt: pending.connectedAt },
          });
          break;
        }

        case "approval_response":
          if (message.approved) {
            const pending = pendingConnections.get(peerName);
            if (!pending) return;
            pendingConnections.delete(peerName);
            finalizeApprovedConnection(peerName, pending.socket, pending.host);
            notify({
              type: "peer_approved",
              message: `Peer '${peerName}' approved your connection request.`,
              peerName,
            });
          } else {
            const pending = pendingConnections.get(peerName);
            if (!pending) return;
            pendingConnections.delete(peerName);
            try {
              pending.socket.close();
            } catch {}
            notify({
              type: "peer_denied",
              message: `Peer '${peerName}' denied your connection request.`,
              peerName,
            });
          }
          break;

        case "node_info":
          if (!approved) return;
          remoteNodeInfo.set(peerName, {
            nodeName: message.nodeName,
            trackingDir: message.trackingDir,
            trackingFileCount: message.trackingFileCount,
            trackingFiles: message.trackingFiles || [],
          });
          notify({
            type: "node_info_received",
            message: `Peer '${peerName}' shared tracking info.`,
            peerName,
            data: remoteNodeInfo.get(peerName) as Record<string, unknown>,
          });
          break;

        case "manifest":
          if (!approved) return;
          remoteManifests.set(peerName, message.files);
          notify({
            type: "manifest_received",
            message: `Received manifest from '${peerName}' (${message.files.length} files).`,
            peerName,
            data: { count: message.files.length, files: message.files },
          });
          break;

        case "manifest_request":
          if (!approved || !manifestProvider) return;
          sendToPeer(peerName, {
            type: "manifest",
            files: manifestProvider(),
            from: nodeName,
          });
          break;

        case "file_content":
          if (!approved) return;
          {
            const filePath = message.path as string;
            const content = message.content as string;
            const isBinary = Boolean(message.isBinary);

            notify({
              type: "file_received",
              peerName,
              filePath,
              message: `Received '${filePath}' from '${peerName}'.`,
              data: {
                host: message.host,
                isBinary,
                size: content.length,
              },
            });

            if (isBinary) {
              crdt.applyRemoteBinary(filePath, content);
            } else {
              crdt.applyRemoteDelta(
                {
                  file: filePath,
                  changes: [{ type: "replace", content }],
                  timestamp: Date.now(),
                  author: message.from || peerName,
                  isBinary: false,
                },
                filePath,
              );
            }

            if (fileWriter) {
              try {
                await fileWriter(filePath, content, isBinary);
                notify({
                  type: "file_written",
                  peerName,
                  filePath,
                  message: `Applied '${filePath}' from '${peerName}' to local disk.`,
                  data: { isBinary, size: content.length },
                });
                sendToPeer(peerName, {
                  type: "file_applied",
                  path: filePath,
                  hash: message.hash || hashContent(content, isBinary),
                  from: nodeName,
                  appliedAt: Date.now(),
                });
              } catch (err) {
                logger.error(`Failed to write received file ${filePath}: ${err}`);
                notify({
                  type: "sync_failed",
                  peerName,
                  filePath,
                  message: `Failed to write '${filePath}' received from '${peerName}'.`,
                  data: { error: String(err) },
                });
              }
            }
          }
          break;

        case "file_applied":
          if (!approved) return;
          {
            const expectedHash = sentFileHashes.get(peerName)?.get(message.path);
            const appliedHash = message.hash as string;
            if (expectedHash && expectedHash !== appliedHash) {
              notify({
                type: "sync_failed",
                peerName,
                filePath: message.path,
                message: `Peer '${peerName}' reported an unexpected applied hash for '${message.path}'.`,
                data: { expectedHash, appliedHash },
              });
            }
            setRemoteAppliedFile(peerName, message.path, appliedHash, message.appliedAt || Date.now());
          }
          notify({
            type: "sync_applied",
            peerName,
            filePath: message.path,
            message: `Peer '${peerName}' confirmed it wrote '${message.path}' locally.`,
            data: { hash: message.hash, appliedAt: message.appliedAt || Date.now() },
          });
          break;

        case "file_content_request":
          if (!approved || !fileContentProvider) return;
          {
            const fileData = await fileContentProvider(message.path);
            if (!fileData) {
              notify({
                type: "sync_failed",
                peerName,
                filePath: message.path,
                message: `Peer '${peerName}' requested '${message.path}', but it was not found locally.`,
                data: { direction: "outbound" },
              });
              return;
            }
            const hash = hashContent(fileData.content, fileData.isBinary);
            setSentFileHash(peerName, message.path, hash);
            sendToPeer(peerName, {
              type: "file_content",
              path: message.path,
              content: fileData.content,
              isBinary: fileData.isBinary,
              from: nodeName,
              hash,
            });
            notify({
              type: "file_sent",
              peerName,
              filePath: message.path,
              message: `Sent '${message.path}' to '${peerName}'.`,
              data: { isBinary: fileData.isBinary, size: fileData.content.length, reason: "request" },
            });
          }
          break;

        case "file_deleted":
          if (!approved) return;
          notify({
            type: "file_deleted",
            message: `Peer '${peerName}' deleted '${message.path}'.`,
            peerName,
            filePath: message.path,
            data: { path: message.path },
          });
          break;

        default:
          logger.warn(`Unknown message type from ${peerName}: ${message.type}`);
      }
    } catch (err) {
      logger.error(`Failed to handle message from ${peerName}: ${err}`);
      notify({
        type: "sync_failed",
        peerName,
        message: `Transport error while handling a message from '${peerName}'.`,
        data: { error: String(err) },
      });
    }
  };

  const setupSocket = (socket: any, peerName: string) => {
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
        void handleMessage(peerName, raw, false);
        return;
      }

      const conn = connections.get(peerName);
      if (conn?.approved) {
        void handleMessage(peerName, raw, true);
      }
    });

    socket.on("close", () => {
      pendingConnections.delete(peerName);
      const existed = connections.delete(peerName);
      if (existed) {
        rememberDisconnect(peerName, "socket_closed");
        notify({
          type: "peer_disconnected",
          message: `Peer '${peerName}' disconnected.`,
          peerName,
          data: { reason: "socket_closed" },
        });
      }
      logger.info(`Peer disconnected: ${peerName}`);
    });

    socket.on("error", (err: Error) => {
      logger.error(`Connection error with ${peerName}: ${err}`);
      pendingConnections.delete(peerName);
      const existed = connections.delete(peerName);
      if (existed) {
        rememberDisconnect(peerName, "socket_error");
        notify({
          type: "peer_disconnected",
          peerName,
          message: `Peer '${peerName}' disconnected because of a transport error.`,
          data: { reason: "socket_error", error: String(err) },
        });
      }
    });
  };

  return {
    async start() {
      const { WebSocketServer } = await import("ws");
      server = new WebSocketServer({ port });

      server.on("connection", (socket: any, req: any) => {
        const peerName = (req.headers["x-mesh-node"] as string) || "unknown";
        const host = req.socket.remoteAddress || "unknown";

        logger.info(`Incoming connection from: ${peerName} at ${host}`);

        if (connections.has(peerName)) {
          closePeer(peerName, "replaced_by_new_connection");
        }

        if (approvedPeers.has(peerName)) {
          finalizeApprovedConnection(peerName, socket, host);
          setupSocket(socket, peerName);
          return;
        }

        pendingConnections.set(peerName, {
          peerName,
          socket,
          host,
          connectedAt: Date.now(),
        });
        setupSocket(socket, peerName);
        socket.send(
          JSON.stringify({
            type: "approval_request",
            node: nodeName,
          }),
        );
        notify({
          type: "peer_pending",
          message: `Peer '${peerName}' from ${host} wants to join the mesh. Ask the user if they want to approve or deny this connection. Do NOT approve or deny on your own — wait for the user's decision.`,
          peerName,
          data: { host, connectedAt: Date.now() },
        });
      });

      keepaliveTimer = setInterval(() => {
        for (const [name, conn] of connections) {
          if (!conn.isAlive) {
            logger.warn(`Peer ${name} missed ping, closing connection`);
            try {
              conn.socket.terminate();
            } catch {}
            connections.delete(name);
            rememberDisconnect(name, "ping_timeout");
            notify({
              type: "peer_disconnected",
              peerName: name,
              message: `Peer '${name}' disconnected after missing a keepalive ping.`,
              data: { reason: "ping_timeout" },
            });
            continue;
          }
          conn.isAlive = false;
          if (conn.socket.readyState === 1) {
            conn.socket.send("__ping__");
          }
        }
      }, PING_INTERVAL_MS);
    },

    async stop() {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
      for (const [peerName] of connections) {
        closePeer(peerName, "shutdown");
      }
      for (const [, pending] of pendingConnections) {
        try {
          pending.socket.close();
        } catch {}
      }
      pendingConnections.clear();
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    },

    async connectToPeer(peer: PeerInfo) {
      if (connections.has(peer.name) || pendingConnections.has(peer.name)) {
        return true;
      }

      try {
        const wsModule = await import("ws");
        const ws = new wsModule.default(`ws://${peer.host}:${peer.port}`, {
          headers: {
            "x-mesh-node": nodeName,
          },
        });

        await new Promise<void>((resolve, reject) => {
          ws.on("open", () => {
            if (approvedPeers.has(peer.name)) {
              finalizeApprovedConnection(peer.name, ws, peer.host);
            } else {
              pendingConnections.set(peer.name, {
                peerName: peer.name,
                socket: ws,
                host: peer.host,
                connectedAt: Date.now(),
              });
            }
            setupSocket(ws, peer.name);
            resolve();
          });
          ws.on("error", (err: Error) => reject(err));
        });

        return true;
      } catch (err) {
        logger.error(`Connection to ${peer.name} failed: ${err}`);
        notify({
          type: "sync_failed",
          peerName: peer.name,
          message: `Failed to connect to '${peer.name}'.`,
          data: { host: peer.host, port: peer.port, error: String(err) },
        });
        return false;
      }
    },

    broadcast(message: any) {
      const data = JSON.stringify(message);
      for (const [, conn] of connections) {
        if (conn.approved && conn.socket.readyState === 1) {
          conn.socket.send(data);
        }
      }
    },

    sendToPeer,

    getConnections() {
      return Array.from(connections.keys());
    },

    getPendingConnections() {
      return Array.from(pendingConnections.values());
    },

    approveConnection(peerName: string) {
      const pending = pendingConnections.get(peerName);
      if (!pending) return false;

      pendingConnections.delete(peerName);
      finalizeApprovedConnection(peerName, pending.socket, pending.host);
      sendToPeer(peerName, {
        type: "approval_response",
        approved: true,
        node: nodeName,
      });
      notify({
        type: "peer_approved",
        message: `Approved peer '${peerName}'. Info and manifests will be exchanged automatically.`,
        peerName,
        data: { host: pending.host },
      });
      return true;
    },

    denyConnection(peerName: string) {
      const pending = pendingConnections.get(peerName);
      if (!pending) return false;

      pendingConnections.delete(peerName);
      try {
        pending.socket.send(
          JSON.stringify({
            type: "approval_response",
            approved: false,
            node: nodeName,
          }),
        );
      } catch {}
      try {
        pending.socket.close();
      } catch {}
      notify({
        type: "peer_denied",
        message: `Denied peer '${peerName}'.`,
        peerName,
        data: { host: pending.host },
      });
      return true;
    },

    getRemoteManifest(peerName: string) {
      return remoteManifests.get(peerName) || null;
    },

    requestManifest(peerName: string) {
      sendToPeer(peerName, { type: "manifest_request", from: nodeName });
    },

    sendFileContent(peerName: string, relativePath: string, content: string, isBinary: boolean) {
      const hash = hashContent(content, isBinary);
      setSentFileHash(peerName, relativePath, hash);
      sendToPeer(peerName, {
        type: "file_content",
        path: relativePath,
        content,
        isBinary,
        from: nodeName,
        hash,
      });
      notify({
        type: "file_sent",
        peerName,
        filePath: relativePath,
        message: `Sent '${relativePath}' to '${peerName}'.`,
        data: { isBinary, size: content.length, reason: "push" },
      });
    },

    requestFileContent(peerName: string, relativePath: string) {
      sendToPeer(peerName, {
        type: "file_content_request",
        path: relativePath,
        from: nodeName,
      });
      notify({
        type: "sync_requested",
        peerName,
        filePath: relativePath,
        message: `Requested '${relativePath}' from '${peerName}'.`,
        data: { direction: "pull" },
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
      const payload = JSON.stringify({
        type: "file_deleted",
        path: relativePath,
        from: nodeName,
      });
      for (const [, conn] of connections) {
        if (conn.approved && conn.socket.readyState === 1) {
          conn.socket.send(payload);
        }
      }
    },

    setNotificationHandler(handler) {
      notificationHandler = handler;
    },

    async maintainConnections() {
      for (const [name, conn] of [...connections]) {
        if (conn.socket.readyState === 3) {
          connections.delete(name);
          rememberDisconnect(name, "closed_ready_state");
          notify({
            type: "peer_disconnected",
            peerName: name,
            message: `Peer '${name}' disconnected.`,
            data: { reason: "closed_ready_state" },
          });
        }
      }

      for (const [name, pending] of [...pendingConnections]) {
        if (pending.socket.readyState === 3) {
          pendingConnections.delete(name);
        }
      }
    },

    getNodeInfo(peerName: string) {
      return remoteNodeInfo.get(peerName) || null;
    },

    setNodeInfoProvider(provider) {
      nodeInfoProvider = provider;
    },

    setFileContentProvider(provider) {
      fileContentProvider = provider;
    },

    setManifestProvider(provider) {
      manifestProvider = provider;
    },

    setFileWriter(writer) {
      fileWriter = writer;
    },

    getRemoteAppliedFiles(peerName: string) {
      return Array.from(remoteAppliedFiles.get(peerName)?.values() || []).sort((a, b) => b.appliedAt - a.appliedAt);
    },

    getRecentDisconnects() {
      return [...recentDisconnects];
    },
  };
}
