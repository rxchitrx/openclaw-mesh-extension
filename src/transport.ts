import type { SyncStateService } from "./sync-state.js";
import { isLocalIPv4Address, normalizePeerHost, type PeerInfo } from "./discovery.js";
import type { TrackedFile } from "./file-watcher.js";
import { normalizeRelativePath } from "./path-safety.js";
import {
  MAX_FILE_CONTENT_BYTES,
  MAX_MANIFEST_FILES,
  isRawMessageTooLarge,
  parseMeshMessage,
  validateApprovalResponse,
  validateFileApplied,
  validateFileContent,
  validateFilePathMessage,
  validateFilePreviewRequest,
  validateFilePreviewResponse,
  validateFileRejected,
  validateManifest,
  validateNodeInfo,
  type ValidationResult,
} from "./protocol-validation.js";
import {
  checkTrustedPeer,
  createNonce,
  decodePublicKeyFromWire,
  encodePublicKeyForWire,
  loadOrCreateIdentity,
  signIdentityChallenge,
  touchTrustedPeer,
  trustPeer,
  verifyIdentityProof,
  type MeshIdentity,
} from "./peer-identity.js";

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
  fingerprint?: string;
  publicKey?: string;
  identityVerified?: boolean;
};

export type PendingConnection = {
  peerName: string;
  socket: any;
  host: string;
  connectedAt: number;
  direction: "incoming" | "outgoing";
  fingerprint?: string;
  publicKey?: string;
  identityVerified?: boolean;
  fingerprintMismatch?: boolean;
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
    | "file_preview";
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
  requestFilePreview: (peerName: string, relativePath: string, timeoutMs?: number) => Promise<FilePreview | null>;
  sendLocalManifest: (peerName: string, manifest: TrackedFile[]) => void;
  notifyFileDeleted: (relativePath: string) => void;
  setNotificationHandler: (handler: (notification: TransportNotification) => void) => void;
  maintainConnections: () => Promise<void>;
  getNodeInfo: (peerName: string) => NodeInfo | null;
  getRemoteAppliedFiles: (peerName: string) => RemoteApplyRecord[];
  getRemoteRejectedFiles: (peerName: string) => RemoteRejectRecord[];
  getInFlightSends: (peerName?: string) => InFlightSendRecord[];
  getPeerFingerprint: (peerName: string) => string | null;
  getPeerTrustWarning: (peerName: string) => string | null;
  setNodeInfoProvider: (provider: () => NodeInfo) => void;
  setFileContentProvider: (provider: (relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>) => void;
  setManifestProvider: (provider: () => TrackedFile[]) => void;
  setFileWriter: (writer: (relativePath: string, content: string, isBinary: boolean) => Promise<void>) => void;
  setIgnoreNextChange: (fn: (relativePath: string) => void) => void;
};

export function createTransport(config: TransportConfig): TransportService {
  const { nodeName, port, syncState, logger } = config;
  const identity: MeshIdentity = loadOrCreateIdentity();

  const connections = new Map<string, Connection>();
  const pendingConnections = new Map<string, PendingConnection>();
  const remoteManifests = new Map<string, TrackedFile[]>();
  const approvedPeers = new Set<string>();
  const remoteNodeInfo = new Map<string, NodeInfo>();
  const remoteAppliedFiles = new Map<string, RemoteApplyRecord[]>();
  const remoteRejectedFiles = new Map<string, RemoteRejectRecord[]>();
  const inFlightSends = new Map<string, InFlightSendRecord>();
  const peerTrustWarnings = new Map<string, string>();
  const challengeNonces = new Map<string, string>();
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

  const notify = (notification: TransportNotification) => {
    if (notificationHandler) {
      notificationHandler(notification);
    }
  };

  const invalidPathLabel = (value: unknown): string => typeof value === "string" ? value : "<invalid>";

  const notifyInvalidMessage = (peerName: string, reason: string, filePath?: string) => {
    notify({
      type: "sync_failed",
      message: `Rejected invalid mesh message from '${peerName}': ${reason}.`,
      peerName,
      filePath,
      data: { reason },
    });
  };

  const rejectValidation = <T>(peerName: string, validation: Extract<ValidationResult<T>, { ok: false }>, rawPath?: unknown, hash?: string | null) => {
    logger.warn(`Rejected message from ${peerName}: ${validation.detail}`);
    const filePath = rawPath === undefined ? undefined : invalidPathLabel(rawPath);
    if (rawPath !== undefined) {
      sendFileRejected(peerName, filePath || "<invalid>", validation.reason, hash);
    }
    notifyInvalidMessage(peerName, validation.detail, filePath);
  };

  const rejectUnsafePath = (peerName: string, rawPath: unknown, hash?: string | null) => {
    const label = invalidPathLabel(rawPath);
    logger.warn(`Rejected unsafe path from ${peerName}: ${label}`);
    sendFileRejected(peerName, label, "invalid_path", hash);
    notify({
      type: "sync_failed",
      message: `Rejected unsafe file path from '${peerName}'.`,
      peerName,
      filePath: label,
      data: { file: label, reason: "invalid_path" },
    });
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

  const sendIdentityChallenge = (peerName: string, socket: any) => {
    const nonce = createNonce();
    challengeNonces.set(peerName, nonce);
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({
        type: "identity_challenge",
        nonce,
        node: nodeName,
        fingerprint: identity.fingerprint,
        publicKey: encodePublicKeyForWire(identity.publicKey),
      }));
    }
  };

  const sendIdentityProof = (peerName: string, nonce: string) => {
    sendToPeer(peerName, {
      type: "identity_proof",
      node: nodeName,
      fingerprint: identity.fingerprint,
      publicKey: encodePublicKeyForWire(identity.publicKey),
      signature: signIdentityChallenge(identity, nonce, nodeName),
    });
  };

  const notifyPendingApproval = (pending: PendingConnection) => {
    if (pending.direction !== "incoming") {
      notify({
        type: "peer_pending",
        message: `Connection request sent to '${pending.peerName}' at ${pending.host}. Waiting for that peer to approve.`,
        peerName: pending.peerName,
        data: {
          host: pending.host,
          direction: pending.direction,
          fingerprint: pending.fingerprint,
          identityVerified: pending.identityVerified,
          fingerprintMismatch: pending.fingerprintMismatch,
        },
      });
      return;
    }

    const warning = pending.fingerprintMismatch
      ? " Possible impersonation: peer name matches a trusted peer but fingerprint changed."
      : "";
    notify({
      type: "peer_pending",
      message: `Peer '${pending.peerName}' from ${pending.host} wants to join the mesh. Fingerprint: ${pending.fingerprint || "unverified"}.${warning} Ask the user if they want to approve or deny this connection. Do NOT approve or deny on your own — wait for the user's decision.`,
      peerName: pending.peerName,
      data: {
        host: pending.host,
        direction: pending.direction,
        fingerprint: pending.fingerprint,
        identityVerified: pending.identityVerified,
        fingerprintMismatch: pending.fingerprintMismatch,
      },
    });
  };

  const promotePendingConnection = (peerName: string, pending: PendingConnection, approved: boolean) => {
    const conn: Connection = {
      peerName,
      socket: pending.socket,
      isAlive: true,
      approved,
      fingerprint: pending.fingerprint,
      publicKey: pending.publicKey,
      identityVerified: pending.identityVerified,
    };
    connections.set(peerName, conn);
    pendingConnections.delete(peerName);
    return conn;
  };

  const handleVerifiedIdentity = (peerName: string, fingerprint: string, publicKey: string) => {
    const pending = pendingConnections.get(peerName);
    const conn = connections.get(peerName);
    const trust = checkTrustedPeer(peerName, fingerprint);
    const mismatch = trust.mismatch;
    const warning = mismatch ? `Possible impersonation: peer '${peerName}' presented fingerprint ${fingerprint}, expected ${trust.peer?.fingerprint}.` : null;
    if (warning) {
      peerTrustWarnings.set(peerName, warning);
      logger.warn(warning);
    } else {
      peerTrustWarnings.delete(peerName);
    }

    if (pending) {
      pending.fingerprint = fingerprint;
      pending.publicKey = publicKey;
      pending.identityVerified = true;
      pending.fingerprintMismatch = mismatch;
      if (pending.direction === "outgoing") {
        notifyPendingApproval(pending);
        return;
      }
      if (trust.trusted && !mismatch) {
        sendToPeer(peerName, {
          type: "approval_response",
          approved: true,
          node: nodeName,
        });
        const promoted = promotePendingConnection(peerName, pending, true);
        approvedPeers.add(peerName);
        touchTrustedPeer(peerName);
        notify({
          type: "peer_approved",
          message: `Auto-approved trusted peer '${peerName}' (${fingerprint}).`,
          peerName,
          data: { fingerprint, identityVerified: true, direction: "outbound" },
        });
        exchangePeerState(promoted.peerName);
      } else {
        notifyPendingApproval(pending);
      }
      return;
    }

    if (conn) {
      conn.fingerprint = fingerprint;
      conn.publicKey = publicKey;
      conn.identityVerified = true;
      if (trust.trusted && !mismatch) {
        touchTrustedPeer(peerName);
      }
    }
  };

  const handleMessage = async (peerName: string, data: string, approved: boolean) => {
    try {
      const parsed = parseMeshMessage(data);
      if (!parsed.ok) {
        rejectValidation(peerName, parsed);
        return;
      }
      const message = parsed.value;

      switch (message.type) {
        case "identity_challenge":
          {
            if (typeof message.nonce !== "string" || message.nonce.length > 1024) {
              rejectValidation(peerName, { ok: false, reason: "invalid_message", detail: "invalid identity challenge nonce" });
              break;
            }
            sendIdentityProof(peerName, message.nonce);
          }
          break;

        case "identity_proof":
          {
            const nonce = challengeNonces.get(peerName);
            const fingerprint = typeof message.fingerprint === "string" ? message.fingerprint : "";
            const publicKey = decodePublicKeyFromWire(message.publicKey);
            const signature = typeof message.signature === "string" ? message.signature : "";
            const proofNode = typeof message.node === "string" ? message.node : peerName;
            if (!nonce || !fingerprint || !publicKey || !signature) {
              rejectValidation(peerName, { ok: false, reason: "invalid_message", detail: "invalid identity proof" });
              break;
            }
            if (!verifyIdentityProof(publicKey, nonce, proofNode, fingerprint, signature)) {
              rejectValidation(peerName, { ok: false, reason: "invalid_message", detail: "identity proof verification failed" });
              break;
            }
            challengeNonces.delete(peerName);
            handleVerifiedIdentity(peerName, fingerprint, publicKey);
          }
          break;

        case "approval_request":
          {
            const pending = pendingConnections.get(peerName);
            if (pending && pending.direction === "incoming" && pending.identityVerified) {
              logger.info(`Approval request from: ${peerName}`);
              notifyPendingApproval(pending);
            }
          }
          break;

        case "approval_response":
          {
          const validation = validateApprovalResponse(message);
          if (!validation.ok) {
            rejectValidation(peerName, validation);
            break;
          }
          if (validation.value.approved) {
            const pending = pendingConnections.get(peerName);
            if (pending) {
              if (pending.direction !== "outgoing") {
                logger.warn(`Ignoring approval_response on inbound approval decision for peer: ${peerName}`);
                break;
              }
              if (!pending.identityVerified || pending.fingerprintMismatch || !pending.fingerprint || !pending.publicKey) {
                logger.warn(`Ignoring approval_response from unverified peer: ${peerName}`);
                break;
              }
              promotePendingConnection(peerName, pending, true);
              approvedPeers.add(peerName);
              trustPeer(peerName, pending.fingerprint, pending.publicKey);
              notify({
                type: "peer_approved",
                message: `Peer '${peerName}' (${pending.fingerprint}) approved your connection request.`,
                peerName,
                data: { fingerprint: pending.fingerprint, identityVerified: true, direction: "inbound" },
              });
              exchangePeerState(peerName);
            }
          } else {
            const pending = pendingConnections.get(peerName);
            if (pending) {
              if (pending.direction !== "outgoing") {
                logger.warn(`Ignoring denial response on inbound approval decision for peer: ${peerName}`);
                break;
              }
              pending.socket.close();
              pendingConnections.delete(peerName);
              notify({
                type: "peer_denied",
                message: `Peer '${peerName}' denied your connection request.`,
                peerName,
                data: { direction: "inbound" },
              });
            }
          }
          }
          break;

        case "node_info":
          if (!approved) return;
          {
            const validation = validateNodeInfo(message);
            if (!validation.ok) {
              rejectValidation(peerName, validation);
              break;
            }
            const info: NodeInfo = {
              nodeName: validation.value.nodeName,
              trackingDir: validation.value.trackingDir,
              trackingFileCount: validation.value.trackingFileCount,
              trackingFiles: validation.value.trackingFiles,
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
          {
            const validation = validateManifest(message);
            if (!validation.ok) {
              rejectValidation(peerName, validation);
              break;
            }
            remoteManifests.set(peerName, validation.value.files);
            const dropped = validation.value.droppedEntries > 0 ? ` (${validation.value.droppedEntries} invalid or excess entries dropped)` : "";
            notify({
              type: "manifest_received",
              message: `Received manifest from '${peerName}' (${validation.value.files.length} files)${dropped}.`,
              peerName,
              data: validation.value.files,
            });
          }
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
            const validation = validateFileContent(message);
            if (!validation.ok) {
              rejectValidation(peerName, validation, message.path, typeof message.hash === "string" ? message.hash : undefined);
              break;
            }
            const { path: filePath, content, isBinary, hash: remoteHash } = validation.value;

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
                const reason = err instanceof Error && err.message === "invalid_path" ? "invalid_path" : "write_failed";
                sendFileRejected(peerName, filePath, reason, remoteHash);
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
            if (!fileContentProvider) {
              return;
            }
            const validation = validateFilePreviewRequest(message);
            if (!validation.ok) {
              sendToPeer(peerName, {
                type: "file_preview_response",
                requestId: typeof message.requestId === "string" ? message.requestId : "invalid",
                path: invalidPathLabel(message.path),
                error: validation.reason,
                from: nodeName,
              });
              rejectValidation(peerName, validation);
              break;
            }
            const { requestId, path: filePath } = validation.value;
            const fileData = await fileContentProvider(filePath);
            if (fileData) {
              sendToPeer(peerName, {
                type: "file_preview_response",
                requestId,
                path: filePath,
                content: fileData.content,
                isBinary: fileData.isBinary,
                hash: syncState.getLocalHash(filePath),
                from: nodeName,
              });
            } else {
              sendToPeer(peerName, {
                type: "file_preview_response",
                requestId,
                path: filePath,
                error: "file_not_found",
                from: nodeName,
              });
            }
          }
          break;

        case "file_preview_response":
          if (!approved) return;
          {
            if (typeof message.requestId !== "string") {
              rejectValidation(peerName, { ok: false, reason: "invalid_message", detail: "requestId must be a string" });
              break;
            }
            const request = previewRequests.get(message.requestId);
            if (!request) return;
            clearTimeout(request.timer);
            previewRequests.delete(message.requestId);
            const validation = validateFilePreviewResponse(message);
            if (!validation.ok) {
              notify({
                type: "file_preview",
                message: `Rejected invalid preview response from '${peerName}': ${validation.detail}.`,
                peerName,
                filePath: invalidPathLabel(message.path),
                data: { error: validation.reason, file: invalidPathLabel(message.path) },
              });
              request.resolve(null);
              break;
            }
            const preview = validation.value;
            if (preview.error) {
              notify({
                type: "file_preview",
                message: `Could not preview '${preview.path}' from '${peerName}': ${preview.error}.`,
                peerName,
                filePath: preview.path,
                data: { error: preview.error, file: preview.path },
              });
              request.resolve(null);
            } else {
              request.resolve({
                path: preview.path,
                content: preview.content || "",
                isBinary: preview.isBinary,
                hash: preview.hash,
              });
            }
          }
          break;

        case "file_content_request":
          if (!approved) return;
          {
            if (fileContentProvider) {
              const validation = validateFilePathMessage(message, "file_content_request");
              if (!validation.ok) {
                rejectValidation(peerName, validation, message.path);
                break;
              }
              const filePath = validation.value.path;
              const fileData = await fileContentProvider(filePath);
              if (fileData) {
                const localHash = syncState.getLocalHash(filePath);
                sendToPeer(peerName, {
                  type: "file_content",
                  path: filePath,
                  content: fileData.content,
                  isBinary: fileData.isBinary,
                  hash: localHash,
                  from: nodeName,
                });
                logger.info(`Sent requested file ${filePath} to ${peerName}`);
                notify({
                  type: "file_sent",
                  message: `Sent '${filePath}' to '${peerName}'.`,
                  peerName,
                  filePath,
                  data: { file: filePath, isBinary: fileData.isBinary, direction: "response" },
                });
              } else {
                logger.warn(`Requested file not found: ${filePath}`);
                notify({
                  type: "sync_failed",
                  message: `Peer '${peerName}' requested '${filePath}', but it was not found locally.`,
                  peerName,
                  filePath,
                  data: { file: filePath },
                });
              }
            }
          }
          break;

        case "file_applied":
          if (!approved) return;
          {
            const validation = validateFileApplied(message);
            if (!validation.ok) {
              rejectValidation(peerName, validation);
              break;
            }
            const record: RemoteApplyRecord = {
              path: validation.value.path,
              hash: validation.value.hash,
              appliedAt: validation.value.appliedAt,
              from: validation.value.from || peerName,
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
            const validation = validateFileRejected(message);
            if (!validation.ok) {
              rejectValidation(peerName, validation);
              break;
            }
            const record: RemoteRejectRecord = {
              path: validation.value.path,
              hash: validation.value.hash,
              rejectedAt: validation.value.rejectedAt,
              from: validation.value.from || peerName,
              reason: validation.value.reason,
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
          {
            const validation = validateFilePathMessage(message, "file_deleted");
            if (!validation.ok) {
              rejectValidation(peerName, validation);
              break;
            }
            const filePath = validation.value.path;
            notify({
              type: "file_deleted",
              message: `Peer '${peerName}' deleted '${filePath}'. Keep your copy or say 'delete ${filePath} locally'.`,
              peerName,
              filePath,
              data: { path: filePath },
            });
          }
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
      return;
    }
    const pending = pendingConnections.get(peerName);
    if (pending && pending.socket.readyState === 1) {
      pending.socket.send(JSON.stringify(message));
    }
  };

  const setupSocket = (socket: any, peerName: string, isIncoming: boolean) => {
    socket.on("message", (data: Buffer) => {
      if (isRawMessageTooLarge(data.length)) {
        logger.warn(`Rejected oversized raw message from ${peerName}: ${data.length} bytes`);
        notifyInvalidMessage(peerName, "raw message exceeds limit");
        return;
      }
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
          const host = normalizePeerHost(req.socket.remoteAddress || "unknown");

          logger.info(`Incoming connection from: ${peerName} at ${host}`);

          if (peerName === nodeName) {
            logger.warn(`Rejecting self mesh connection from ${peerName} at ${host}`);
            socket.close();
            return;
          }

          const alreadyConnected = connections.has(peerName);

          if (alreadyConnected) {
            const old = connections.get(peerName)!;
            old.socket.close();
            connections.delete(peerName);
          }

          const pending: PendingConnection = {
            peerName,
            socket,
            host,
            connectedAt: Date.now(),
            direction: "incoming",
            fingerprint: typeof req.headers["x-mesh-fingerprint"] === "string" ? req.headers["x-mesh-fingerprint"] : undefined,
            publicKey: decodePublicKeyFromWire(req.headers["x-mesh-public-key"]) || undefined,
            identityVerified: false,
          };
          pendingConnections.set(peerName, pending);
          setupSocket(socket, peerName, true);
          sendIdentityChallenge(peerName, socket);
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
      const normalizedHost = normalizePeerHost(peer.host);
      if (peer.name === nodeName || (isLocalIPv4Address(normalizedHost) && peer.port === port)) {
        logger.warn(`Refusing to connect mesh node to itself: ${peer.name} at ${peer.host}:${peer.port}`);
        return false;
      }
      if (connections.has(peer.name)) return true;
      if (pendingConnections.has(peer.name)) return true;

      try {
        const wsModule = await import("ws");
        const ws = new wsModule.default(`ws://${normalizedHost}:${peer.port}`, {
          headers: {
            "x-mesh-node": nodeName,
            "x-mesh-fingerprint": identity.fingerprint,
            "x-mesh-public-key": encodePublicKeyForWire(identity.publicKey),
          },
        });

        await new Promise<void>((resolve, reject) => {
          ws.on("open", () => {
            const pending: PendingConnection = {
              peerName: peer.name,
              socket: ws,
              host: normalizedHost,
              connectedAt: Date.now(),
              direction: "outgoing",
              identityVerified: false,
            };
            pendingConnections.set(peer.name, pending);
            setupSocket(ws, peer.name, false);
            sendIdentityChallenge(peer.name, ws);
            logger.info(`Connected to peer (awaiting identity proof): ${peer.name} at ${normalizedHost}:${peer.port}`);

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
      if (pending.direction !== "incoming") {
        logger.warn(`Refusing to approve outbound connection request locally: ${peerName}`);
        return false;
      }
      if (!pending.identityVerified || !pending.fingerprint || !pending.publicKey || pending.fingerprintMismatch) {
        logger.warn(`Refusing to approve unverified or mismatched peer: ${peerName}`);
        return false;
      }

      promotePendingConnection(peerName, pending, true);
      approvedPeers.add(peerName);
      trustPeer(peerName, pending.fingerprint, pending.publicKey);

      sendToPeer(peerName, {
        type: "approval_response",
        approved: true,
        node: nodeName,
      });

      logger.info(`Approved peer: ${peerName}`);
      notify({
        type: "peer_approved",
        message: `Approved peer '${peerName}' (${pending.fingerprint}). Info will be exchanged.`,
        peerName,
        data: { fingerprint: pending.fingerprint, identityVerified: true, direction: "outbound" },
      });
      exchangePeerState(peerName);

      return true;
    },

    denyConnection(peerName: string): boolean {
      const pending = pendingConnections.get(peerName);
      if (!pending) return false;
      if (pending.direction !== "incoming") {
        logger.warn(`Refusing to deny outbound connection request locally: ${peerName}`);
        return false;
      }

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
        data: { direction: "outbound" },
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
      const safeRelativePath = normalizeRelativePath(relativePath);
      if (!safeRelativePath) {
        logger.warn(`Refusing to send unsafe file path to ${peerName}: ${relativePath}`);
        return;
      }
      if (Buffer.byteLength(content, "utf-8") > MAX_FILE_CONTENT_BYTES) {
        logger.warn(`Refusing to send oversized file to ${peerName}: ${safeRelativePath}`);
        notify({
          type: "sync_failed",
          message: `Refused to send '${safeRelativePath}' to '${peerName}' because it exceeds the 10 MB mesh payload limit.`,
          peerName,
          filePath: safeRelativePath,
          data: { file: safeRelativePath, reason: "payload_too_large" },
        });
        return;
      }
      const localHash = syncState.getLocalHash(safeRelativePath);
      sendToPeer(peerName, {
        type: "file_content",
        path: safeRelativePath,
        content,
        isBinary,
        hash: localHash,
        from: nodeName,
      });
      inFlightSends.set(`${peerName}:${safeRelativePath}`, {
        peerName,
        path: safeRelativePath,
        hash: localHash || undefined,
        sentAt: Date.now(),
      });
      notify({
        type: "file_sent",
        message: `Sent '${safeRelativePath}' to '${peerName}'.`,
        peerName,
        filePath: safeRelativePath,
        data: { file: safeRelativePath, isBinary, direction: "push" },
      });
    },

    requestFileContent(peerName: string, relativePath: string) {
      const safeRelativePath = normalizeRelativePath(relativePath);
      if (!safeRelativePath) {
        logger.warn(`Refusing to request unsafe file path from ${peerName}: ${relativePath}`);
        return;
      }
      sendToPeer(peerName, {
        type: "file_content_request",
        path: safeRelativePath,
        from: nodeName,
      });
    },

    requestFilePreview(peerName: string, relativePath: string, timeoutMs = 5000) {
      const safeRelativePath = normalizeRelativePath(relativePath);
      if (!safeRelativePath) {
        logger.warn(`Refusing to preview unsafe file path from ${peerName}: ${relativePath}`);
        return Promise.resolve(null);
      }
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
            message: `Timed out previewing '${safeRelativePath}' from '${peerName}'.`,
            peerName,
            filePath: safeRelativePath,
            data: { file: safeRelativePath, timeoutMs },
          });
          resolve(null);
        }, timeoutMs);
        previewRequests.set(requestId, { resolve, timer });
        sendToPeer(peerName, {
          type: "file_preview_request",
          requestId,
          path: safeRelativePath,
          from: nodeName,
        });
      });
    },

    sendLocalManifest(peerName: string, manifest: TrackedFile[]) {
      const validation = validateManifest({ type: "manifest", files: manifest });
      const files = validation.ok ? validation.value.files : [];
      if (files.length < manifest.length || files.length > MAX_MANIFEST_FILES) {
        logger.warn(`Sending sanitized manifest to ${peerName}: ${files.length}/${manifest.length} files`);
      }
      sendToPeer(peerName, {
        type: "manifest",
        files,
        from: nodeName,
      });
    },

    notifyFileDeleted(relativePath: string) {
      const safeRelativePath = normalizeRelativePath(relativePath);
      if (!safeRelativePath) {
        logger.warn(`Refusing to notify deletion for unsafe file path: ${relativePath}`);
        return;
      }
      const msg = { type: "file_deleted", path: safeRelativePath, from: nodeName };
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

    getPeerFingerprint(peerName: string): string | null {
      return connections.get(peerName)?.fingerprint || pendingConnections.get(peerName)?.fingerprint || null;
    },

    getPeerTrustWarning(peerName: string): string | null {
      return peerTrustWarnings.get(peerName) || null;
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
