import type { SyncStateService } from "./sync-state.js";
import type { PeerInfo } from "./discovery.js";
import type { TrackedFile } from "./file-watcher.js";
import * as zlib from "zlib";

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

export type RemoteApplyRecord = {
  path: string;
  hash?: string;
  appliedAt: number;
  from: string;
};

export type RemoteRejectRecord = {
  path: string;
  hash?: string;
  rejectedAt: number;
  from: string;
  reason: string;
};

export type InFlightSendRecord = {
  path: string;
  hash?: string;
  sentAt: number;
  peerName: string;
};

export type FilePreview = {
  path: string;
  content: string;
  isBinary: boolean;
  hash?: string | null;
};

export type TransportNotification = {
  type:
    | "peer_pending"
    | "peer_approved"
    | "peer_denied"
    | "peer_connected"
    | "peer_disconnected"
    | "file_deleted"
    | "file_conflict"
    | "conflict"
    | "manifest_received"
    | "node_info_received"
    | "sync_requested"
    | "sync_applied"
    | "sync_failed"
    | "file_sent"
    | "file_received"
    | "file_written"
    | "file_rejected"
    | "file_preview"
    | "file_patch";
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
  sendFileContent: (peerName: string, relativePath: string, content: string, isBinary: boolean) => Promise<void>;
  sendFilePatch: (peerName: string, relativePath: string, patch: string, parentHash: string, targetHash: string) => void;
  requestFileContent: (peerName: string, relativePath: string) => void;
  requestFilePreview: (peerName: string, relativePath: string, timeoutMs?: number) => Promise<FilePreview | null>;
  sendLocalManifest: (peerName: string, manifest: TrackedFile[]) => void;
  notifyFileDeleted: (relativePath: string) => void;
  setNotificationHandler: (handler: (notification: TransportNotification) => void) => void;
  maintainConnections: () => Promise<void>;
  getNodeInfo: (peerName: string) => NodeInfo | null;
  getRemoteAppliedFiles: (peerName: string) => RemoteApplyRecord[];
  getRemoteRejectedFiles: (peerName: string) => RemoteRejectRecord[];
  getInFlightSends: (peerName?: string) => InFlightSendRecord[];
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
  const remoteAppliedFiles = new Map<string, RemoteApplyRecord[]>();
  const remoteRejectedFiles = new Map<string, RemoteRejectRecord[]>();
  const inFlightSends = new Map<string, InFlightSendRecord>();
  const previewRequests = new Map<string, {
    resolve: (preview: FilePreview | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let nodeInfoProvider: (() => NodeInfo) | null = null;
  let fileContentProvider: ((relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>) | null = null;
  let manifestProvider: (() => TrackedFile[]) | null = null;
  let fileWriter: ((relativePath: string, content: string, isBinary: boolean) => Promise<void>) | null = null;
  let ignoreNextChangeFn: ((relativePath: string) => void) | null = null;
  let server: any = null;
  let notificationHandler: ((notification: TransportNotification) => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  const PING_INTERVAL_MS = 30000;

  const syncStats = {
    patchSyncs: 0,
    fallbackFullSyncs: 0,
    patchBytesOriginal: 0,
    patchBytesCompressed: 0,
  };

  const notify = (notification: TransportNotification) => {
    if (notificationHandler) {
      notificationHandler(notification);
    }
  };

  const sendFileRejected = (peerName: string, relativePath: string, reason: string, hash?: string | null) => {
    sendToPeer(peerName, {
      type: "file_rejected",
      path: relativePath,
      hash,
      reason,
      from: nodeName,
      rejectedAt: Date.now(),
    });
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

        case "file_patch":
          if (!approved) return;
          {
            const { path: filePath, patch: rawPatch, parentHash, targetHash, from, compressed } = message;

            if (!parentHash || !targetHash || !rawPatch) {
              logger.warn(`Received invalid file_patch payload for ${filePath} from ${peerName}`);
              break;
            }

            let patch = rawPatch;
            if (compressed) {
              try {
                patch = zlib.gunzipSync(Buffer.from(rawPatch, "base64")).toString("utf-8");
              } catch (err) {
                logger.error(`Failed to decompress patch for ${filePath}: ${err}`);
                syncStats.fallbackFullSyncs++;
                logger.info(`Fallback full sync requested for ${filePath} from ${peerName}. Fallback sync count: ${syncStats.fallbackFullSyncs}`);
                sendToPeer(peerName, {
                  type: "file_content_request",
                  path: filePath,
                  from: nodeName,
                });
                break;
              }
            }

            logger.info(`Received patch for ${filePath} from ${peerName} (parent: ${parentHash}, target: ${targetHash})`);

            if (syncState.isConflict(filePath, targetHash) && !syncState.consumeForceAllow(filePath)) {
              logger.warn(`Conflict: ${filePath} — local has modifications and remote has different version. Keeping local.`);
              sendFileRejected(peerName, filePath, "conflict", targetHash);
              notify({
                type: "file_conflict",
                message: `Conflict on '${filePath}' from '${peerName}': both sides modified this file. Your local version was kept. Use 'pull ${filePath} from ${peerName}' to override.`,
                peerName,
                filePath,
                data: { file: filePath, remotePeer: peerName },
              });
              break;
            }

            try {
              const localHash = syncState.getLocalHash(filePath);
              if (localHash !== parentHash) {
                throw new Error(`Hash mismatch: local is ${localHash || "missing"}, patch requires ${parentHash}`);
              }

              if (!fileContentProvider || !fileWriter) {
                throw new Error("Missing providers or writers");
              }

              const fileData = await fileContentProvider(filePath);
              if (!fileData || fileData.isBinary) {
                throw new Error(`Cannot patch ${!fileData ? "missing" : "binary"} file`);
              }

              const { applyUnifiedPatch } = await import("./patch-apply.js");
              const reconstructed = applyUnifiedPatch(fileData.content, patch);

              const crypto = await import("crypto");
              const reconstructedHash = crypto.createHash("sha256").update(reconstructed).digest("hex").slice(0, 16);

              if (reconstructedHash !== targetHash) {
                throw new Error(`Patch verification failed: got ${reconstructedHash}, expected ${targetHash}`);
              }

              if (ignoreNextChangeFn) {
                ignoreNextChangeFn(filePath);
              }
              
              await fileWriter(filePath, reconstructed, false);
              syncState.recordRemoteChange(filePath, targetHash, from || peerName, false);

              logger.info(`Patch applied successfully to ${filePath} (${reconstructedHash})`);

              sendToPeer(peerName, {
                type: "file_applied",
                path: filePath,
                hash: targetHash,
                from: nodeName,
                appliedAt: Date.now(),
              });

              notify({
                type: "file_written",
                message: `Patch applied successfully to '${filePath}' from '${peerName}'.`,
                peerName,
                filePath,
                data: { file: filePath, isBinary: false, direction: "received", patched: true },
              });

            } catch (err) {
              logger.warn(`Patch verification failed for ${filePath}: ${err}`);
              syncStats.fallbackFullSyncs++;
              logger.info(`Fallback full sync requested for ${filePath} from ${peerName}. Fallback sync count: ${syncStats.fallbackFullSyncs}`);
              sendToPeer(peerName, {
                type: "file_content_request",
                path: filePath,
                from: nodeName,
              });
            }
          }
          break;

        case "file_content":
          if (!approved) return;
          {
            const { path: filePath, content, isBinary, hash: remoteHash } = message;

            if (syncState.isConflict(filePath, remoteHash || "") && !syncState.consumeForceAllow(filePath)) {
              logger.warn(`Conflict: ${filePath} — local has modifications and remote has different version. Keeping local.`);
              sendFileRejected(peerName, filePath, "conflict", remoteHash);
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
                logger.info(`Wrote received file to disk: ${filePath} from ${peerName}`);
                sendToPeer(peerName, {
                  type: "file_applied",
                  path: filePath,
                  hash: remoteHash,
                  from: nodeName,
                  appliedAt: Date.now(),
                });
                notify({
                  type: "file_written",
                  message: `Wrote '${filePath}' from '${peerName}' to the tracked directory.`,
                  peerName,
                  filePath,
                  data: { file: filePath, isBinary, direction: "received" },
                });
              } catch (err) {
                logger.error(`Failed to write received file ${filePath}: ${err}`);
                sendFileRejected(peerName, filePath, "write_failed", remoteHash);
                notify({
                  type: "sync_failed",
                  message: `Failed to write '${filePath}' from '${peerName}' to disk.`,
                  peerName,
                  filePath,
                  data: { file: filePath, isBinary, error: String(err) },
                });
              }
            } else {
              logger.info(`Received file (no writer): ${filePath} from ${peerName}`);
            }

            notify({
              type: "file_received",
              message: `Received '${filePath}' from '${peerName}' (${content.length} chars, ${isBinary ? "binary" : "text"}).`,
              peerName,
              filePath,
              data: { file: filePath, isBinary },
            });
          }
          break;

        case "file_preview_request":
          if (!approved) return;
          {
            const requestId = message.requestId;
            if (!requestId || !fileContentProvider) {
              return;
            }
            const fileData = await fileContentProvider(message.path);
            if (fileData) {
              sendToPeer(peerName, {
                type: "file_preview_response",
                requestId,
                path: message.path,
                content: fileData.content,
                isBinary: fileData.isBinary,
                hash: syncState.getLocalHash(message.path),
                from: nodeName,
              });
            } else {
              sendToPeer(peerName, {
                type: "file_preview_response",
                requestId,
                path: message.path,
                error: "file_not_found",
                from: nodeName,
              });
            }
          }
          break;

        case "file_preview_response":
          if (!approved) return;
          {
            const request = previewRequests.get(message.requestId);
            if (!request) return;
            clearTimeout(request.timer);
            previewRequests.delete(message.requestId);
            if (message.error) {
              notify({
                type: "file_preview",
                message: `Could not preview '${message.path}' from '${peerName}': ${message.error}.`,
                peerName,
                filePath: message.path,
                data: { error: message.error, file: message.path },
              });
              request.resolve(null);
            } else {
              request.resolve({
                path: message.path,
                content: message.content,
                isBinary: !!message.isBinary,
                hash: message.hash,
              });
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
                notify({
                  type: "file_sent",
                  message: `Sent '${message.path}' to '${peerName}'.`,
                  peerName,
                  filePath: message.path,
                  data: { file: message.path, isBinary: fileData.isBinary, direction: "response" },
                });
              } else {
                logger.warn(`Requested file not found: ${message.path}`);
                notify({
                  type: "sync_failed",
                  message: `Peer '${peerName}' requested '${message.path}', but it was not found locally.`,
                  peerName,
                  filePath: message.path,
                  data: { file: message.path },
                });
              }
            }
          }
          break;

        case "file_applied":
          if (!approved) return;
          {
            const record: RemoteApplyRecord = {
              path: message.path,
              hash: message.hash,
              appliedAt: typeof message.appliedAt === "number" ? message.appliedAt : Date.now(),
              from: message.from || peerName,
            };
            const existing = remoteAppliedFiles.get(peerName) || [];
            const next = existing.filter((item) => item.path !== record.path);
            next.push(record);
            remoteAppliedFiles.set(peerName, next.slice(-500));
            const inFlightKey = `${peerName}:${record.path}`;
            const inFlight = inFlightSends.get(inFlightKey);
            if (inFlight && (!record.hash || !inFlight.hash || record.hash === inFlight.hash)) {
              inFlightSends.delete(inFlightKey);
              const syncedHash = record.hash || inFlight.hash;
              const stillInFlightForPath = [...inFlightSends.values()].some((item) => item.path === record.path && item.hash === syncedHash);
              const rejectedForHash = [...remoteRejectedFiles.values()]
                .flat()
                .some((item) => item.path === record.path && (!item.hash || item.hash === syncedHash));
              if (syncedHash && syncedHash === syncState.getLocalHash(record.path) && !stillInFlightForPath && !rejectedForHash) {
                syncState.recordSyncedHash(record.path, syncedHash);
                syncState.clearPendingChanges([record.path]);
              }
            }
            notify({
              type: "sync_applied",
              message: `Peer '${peerName}' applied '${record.path}' to disk${record.hash ? ` (${record.hash.slice(0, 8)})` : ""}.`,
              peerName,
              filePath: record.path,
              data: record,
            });
          }
          break;

        case "file_rejected":
          if (!approved) return;
          {
            const record: RemoteRejectRecord = {
              path: message.path,
              hash: message.hash,
              rejectedAt: typeof message.rejectedAt === "number" ? message.rejectedAt : Date.now(),
              from: message.from || peerName,
              reason: message.reason || "unknown",
            };
            const existing = remoteRejectedFiles.get(peerName) || [];
            const next = existing.filter((item) => item.path !== record.path);
            next.push(record);
            remoteRejectedFiles.set(peerName, next.slice(-500));
            inFlightSends.delete(`${peerName}:${record.path}`);
            notify({
              type: "file_rejected",
              message: `Peer '${peerName}' rejected '${record.path}' (${record.reason}).`,
              peerName,
              filePath: record.path,
              data: record,
            });
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

      for (const [, request] of previewRequests) {
        clearTimeout(request.timer);
        request.resolve(null);
      }
      previewRequests.clear();

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

    sendFilePatch(peerName: string, relativePath: string, patch: string, parentHash: string, targetHash: string) {
      const originalBytes = Buffer.byteLength(patch, "utf-8");
      const compressedBuffer = zlib.gzipSync(patch);
      const compressedBytes = compressedBuffer.length;
      
      const payload = compressedBuffer.toString("base64");
      
      syncStats.patchSyncs++;
      syncStats.patchBytesOriginal += originalBytes;
      syncStats.patchBytesCompressed += compressedBytes;
      
      const savedBytes = originalBytes - compressedBytes;
      const savedPercent = originalBytes > 0 ? Math.round((savedBytes / originalBytes) * 100) : 0;
      
      logger.info(`Patch compressed: ${originalBytes} → ${compressedBytes} bytes. Saved ${savedPercent}% transfer size.`);
      
      sendToPeer(peerName, {
        type: "file_patch",
        path: relativePath,
        patch: payload,
        compressed: true,
        parentHash,
        targetHash,
        from: nodeName,
      });
      logger.info(`Sent file patch for '${relativePath}' to '${peerName}'`);
      notify({
        type: "file_patch",
        message: `Sent patch for '${relativePath}' to '${peerName}'.`,
        peerName,
        filePath: relativePath,
        data: { file: relativePath, parentHash, targetHash, direction: "push" },
      });
    },

    async sendFileContent(peerName: string, relativePath: string, content: string, isBinary: boolean) {
      const localHash = syncState.getLocalHash(relativePath);

      let patchSent = false;
      if (!isBinary) {
        try {
          const preview = await this.requestFilePreview(peerName, relativePath, 5000);
          if (preview && preview.content && preview.hash && localHash) {
            const { createPatchPayload } = await import("./diff-engine.js");
            const patchPayload = createPatchPayload(relativePath, preview.content, content, preview.hash, localHash);

            if (patchPayload && patchPayload.patch) {
              this.sendFilePatch(peerName, relativePath, patchPayload.patch, patchPayload.parentHash, patchPayload.targetHash);
              logger.info(`Generated patch for file ${relativePath} Patch size: ${Buffer.byteLength(patchPayload.patch, "utf-8")} bytes`);
              patchSent = true;
            }
          }
        } catch (err) {
          logger.warn(`Failed to generate patch for ${relativePath}: ${err}`);
        }
      }

      if (!patchSent) {
        syncStats.fallbackFullSyncs++;
        logger.info(`Fallback to full sync for ${relativePath}`);
        logger.info(`Fallback sync count: ${syncStats.fallbackFullSyncs}`);
        sendToPeer(peerName, {
          type: "file_content",
          path: relativePath,
          content,
          isBinary,
          hash: localHash,
          from: nodeName,
        });
        inFlightSends.set(`${peerName}:${relativePath}`, {
          peerName,
          path: relativePath,
          hash: localHash || undefined,
          sentAt: Date.now(),
        });
        notify({
          type: "file_sent",
          message: `Sent '${relativePath}' to '${peerName}'.`,
          peerName,
          filePath: relativePath,
          data: { file: relativePath, isBinary, direction: "push" },
        });
      }
    },

    requestFileContent(peerName: string, relativePath: string) {
      sendToPeer(peerName, {
        type: "file_content_request",
        path: relativePath,
        from: nodeName,
      });
    },

    requestFilePreview(peerName: string, relativePath: string, timeoutMs = 5000) {
      const conn = connections.get(peerName);
      if (!conn || !conn.approved || conn.socket.readyState !== 1) {
        return Promise.resolve(null);
      }
      const requestId = `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise<FilePreview | null>((resolve) => {
        const timer = setTimeout(() => {
          previewRequests.delete(requestId);
          notify({
            type: "file_preview",
            message: `Timed out previewing '${relativePath}' from '${peerName}'.`,
            peerName,
            filePath: relativePath,
            data: { file: relativePath, timeoutMs },
          });
          resolve(null);
        }, timeoutMs);
        previewRequests.set(requestId, { resolve, timer });
        sendToPeer(peerName, {
          type: "file_preview_request",
          requestId,
          path: relativePath,
          from: nodeName,
        });
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

    getRemoteAppliedFiles(peerName: string): RemoteApplyRecord[] {
      return [...(remoteAppliedFiles.get(peerName) || [])];
    },

    getRemoteRejectedFiles(peerName: string): RemoteRejectRecord[] {
      return [...(remoteRejectedFiles.get(peerName) || [])];
    },

    getInFlightSends(peerName?: string): InFlightSendRecord[] {
      const records = [...inFlightSends.values()];
      return peerName ? records.filter((record) => record.peerName === peerName) : records;
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
