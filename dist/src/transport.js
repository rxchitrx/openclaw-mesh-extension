import * as fs from "fs";
import * as crypto from "crypto";
import * as os from "os";
import * as path from "path";
import { isLocalIPv4Address, normalizePeerHost } from "./discovery.js";
import { normalizeRelativePath } from "./path-safety.js";
import { createShadowStore } from "./shadow-store.js";
import { MAX_MANIFEST_FILES, isRawMessageTooLarge, parseMeshMessage, validateApprovalResponse, validateCapabilityExecute, validateCapabilityExecuteResult, validateFileApplied, validateFileChunk, validateFileContent, validateFilePathMessage, validateFilePreviewRequest, validateFilePreviewResponse, validateFileRejected, validateManifest, validateNodeInfo, } from "./protocol-validation.js";
import { checkTrustedPeer, createNonce, decodePublicKeyFromWire, encodePublicKeyForWire, loadOrCreateIdentity, signIdentityChallenge, touchTrustedPeer, trustPeer, verifyIdentityProof, } from "./peer-identity.js";
import * as zlib from "zlib";
import { WebSocketTransport } from "./transport/websocket-transport.js";
// Shadow store: persists last-sent file content to disk (keyed by hash) so we
// can generate patches locally without asking the peer for their copy.
const shadowStore = createShadowStore();
export function createTransport(config) {
    const { nodeName, port, syncState, logger } = config;
    const executionTimeoutMs = config.executionTimeoutMs ?? 60000;
    const identity = loadOrCreateIdentity();
    const connections = new Map();
    const pendingConnections = new Map();
    const remoteManifests = new Map();
    const approvedPeers = new Set();
    const remoteNodeInfo = new Map();
    const remoteAppliedFiles = new Map();
    const remoteRejectedFiles = new Map();
    const inFlightSends = new Map();
    const chunkAssemblyQueues = new Map();
    const peerTrustWarnings = new Map();
    const challengeNonces = new Map();
    const previewRequests = new Map();
    const pendingExecutions = new Map();
    let nodeInfoProvider = null;
    let fileContentProvider = null;
    let manifestProvider = null;
    let fileWriter = null;
    let ignoreNextChangeFn = null;
    let server = null;
    let webRTCDialer = null;
    const tmpDir = path.join(os.tmpdir(), "openclaw-mesh", nodeName);
    fs.mkdirSync(tmpDir, { recursive: true });
    let notificationHandler = null;
    let keepaliveTimer = null;
    const PING_INTERVAL_MS = 30000;
    const syncStats = {
        patchSyncs: 0,
        fallbackFullSyncs: 0,
        patchBytesOriginal: 0,
        patchBytesCompressed: 0,
    };
    const notify = (notification) => {
        if (notificationHandler) {
            notificationHandler(notification);
        }
    };
    const invalidPathLabel = (value) => typeof value === "string" ? value : "<invalid>";
    const computeMeshContentHash = (content, isBinary) => {
        const hashInput = Buffer.isBuffer(content) && isBinary ? content.toString("base64") : content;
        return crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
    };
    const notifyInvalidMessage = (peerName, reason, filePath) => {
        notify({
            type: "sync_failed",
            message: `Rejected invalid mesh message from '${peerName}': ${reason}.`,
            peerName,
            filePath,
            data: { reason },
        });
    };
    const createExecutionRequestId = () => {
        return `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    };
    const publicPendingExecution = (execution) => ({
        requestId: execution.requestId,
        peerName: execution.peerName,
        direction: execution.direction,
        capability: execution.capability,
        instruction: execution.instruction,
        from: execution.from,
        requestedAt: execution.requestedAt,
        expiresAt: execution.expiresAt,
    });
    const completePendingExecution = (requestId, result, expectedPeerName) => {
        const execution = pendingExecutions.get(requestId);
        if (!execution)
            return false;
        if (expectedPeerName && execution.peerName !== expectedPeerName) {
            logger.warn(`Ignoring capability execution result '${requestId}' from unexpected peer '${expectedPeerName}'. Expected '${execution.peerName}'.`);
            return false;
        }
        clearTimeout(execution.timer);
        pendingExecutions.delete(requestId);
        const timedOut = result.error === "timeout";
        notify({
            type: "capability_execute_completed",
            message: timedOut
                ? `Capability execution request '${requestId}' for '${execution.capability}' from '${execution.peerName}' timed out.`
                : `Capability execution request '${requestId}' for '${execution.capability}' from '${execution.peerName}' completed${result.error ? ` with error: ${result.error}` : ""}.`,
            peerName: execution.peerName,
            data: {
                requestId,
                capability: execution.capability,
                instruction: execution.instruction,
                from: result.from || execution.from,
                requestedAt: execution.requestedAt,
                completedAt: Date.now(),
                error: result.error,
                result: result.result,
                timedOut,
            },
        });
        return true;
    };
    const storePendingExecution = (input) => {
        const existing = pendingExecutions.get(input.requestId);
        if (existing) {
            clearTimeout(existing.timer);
            pendingExecutions.delete(input.requestId);
        }
        const requestedAt = Date.now();
        const execution = {
            ...input,
            requestedAt,
            expiresAt: requestedAt + executionTimeoutMs,
            timer: setTimeout(() => {
                completePendingExecution(input.requestId, { error: "timeout" });
            }, executionTimeoutMs),
        };
        pendingExecutions.set(input.requestId, execution);
        notify({
            type: "capability_execute_requested",
            message: `Peer '${input.peerName}' requested capability '${input.capability}'. Ask the user before executing it.`,
            peerName: input.peerName,
            data: {
                requestId: input.requestId,
                capability: input.capability,
                instruction: input.instruction,
                from: input.from,
                requestedAt,
                expiresAt: execution.expiresAt,
            },
        });
        return publicPendingExecution(execution);
    };
    const rejectValidation = (peerName, validation, rawPath, hash) => {
        logger.warn(`Rejected message from ${peerName}: ${validation.detail}`);
        const filePath = rawPath === undefined ? undefined : invalidPathLabel(rawPath);
        if (rawPath !== undefined) {
            sendFileRejected(peerName, filePath || "<invalid>", validation.reason, hash);
        }
        notifyInvalidMessage(peerName, validation.detail, filePath);
    };
    const rejectUnsafePath = (peerName, rawPath, hash) => {
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
    const sendFileRejected = (peerName, relativePath, reason, hash) => {
        sendToPeer(peerName, {
            type: "file_rejected",
            path: relativePath,
            hash,
            reason,
            from: nodeName,
            rejectedAt: Date.now(),
        });
    };
    const sendIdentityChallenge = (peerName, transport) => {
        const nonce = createNonce();
        challengeNonces.set(peerName, nonce);
        if (transport.isOpen()) {
            transport.send(JSON.stringify({
                type: "identity_challenge",
                nonce,
                node: nodeName,
                fingerprint: identity.fingerprint,
                publicKey: encodePublicKeyForWire(identity.publicKey),
            }));
        }
    };
    const sendIdentityProof = (peerName, nonce) => {
        sendToPeer(peerName, {
            type: "identity_proof",
            node: nodeName,
            fingerprint: identity.fingerprint,
            publicKey: encodePublicKeyForWire(identity.publicKey),
            signature: signIdentityChallenge(identity, nonce, nodeName),
        });
    };
    const notifyPendingApproval = (pending) => {
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
    const promotePendingConnection = (peerName, pending, approved) => {
        const conn = {
            peerName,
            transport: pending.transport,
            isAlive: true,
            approved,
            fingerprint: pending.fingerprint,
            publicKey: pending.publicKey,
            identityVerified: pending.identityVerified,
            transportType: pending.transportType,
            source: pending.source,
        };
        connections.set(peerName, conn);
        pendingConnections.delete(peerName);
        return conn;
    };
    const handleVerifiedIdentity = (peerName, fingerprint, publicKey) => {
        const pending = pendingConnections.get(peerName);
        const conn = connections.get(peerName);
        const trust = checkTrustedPeer(peerName, fingerprint);
        const mismatch = trust.mismatch;
        const warning = mismatch ? `Possible impersonation: peer '${peerName}' presented fingerprint ${fingerprint}, expected ${trust.peer?.fingerprint}.` : null;
        if (warning) {
            peerTrustWarnings.set(peerName, warning);
            logger.warn(warning);
        }
        else {
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
            }
            else {
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
    const handleMessage = async (peerName, data, approved) => {
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
                        }
                        else {
                            const pending = pendingConnections.get(peerName);
                            if (pending) {
                                if (pending.direction !== "outgoing") {
                                    logger.warn(`Ignoring denial response on inbound approval decision for peer: ${peerName}`);
                                    break;
                                }
                                pending.transport.close();
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
                    if (!approved)
                        return;
                    {
                        const validation = validateNodeInfo(message);
                        if (!validation.ok) {
                            rejectValidation(peerName, validation);
                            break;
                        }
                        const info = {
                            nodeName: validation.value.nodeName,
                            trackingDir: validation.value.trackingDir,
                            trackingFileCount: validation.value.trackingFileCount,
                            trackingFiles: validation.value.trackingFiles,
                            capabilities: validation.value.capabilities,
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
                    if (!approved)
                        return;
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
                    if (!approved)
                        return;
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
                case "file_chunk":
                    if (!approved)
                        return;
                    {
                        const validation = validateFileChunk(message);
                        if (!validation.ok) {
                            rejectValidation(peerName, validation, message.path, typeof message.hash === "string" ? message.hash : undefined);
                            break;
                        }
                        const { path: filePath, chunkIndex, totalChunks, chunk, isBinary, hash: remoteHash } = validation.value;
                        const tmpFilePath = path.join(tmpDir, `${Buffer.from(`${peerName}:${filePath}`).toString("hex")}.tmp`);
                        const chunkAssemblyKey = `${peerName}:${filePath}`;
                        const previousAssembly = chunkAssemblyQueues.get(chunkAssemblyKey) ?? Promise.resolve();
                        const currentAssembly = previousAssembly.catch(() => { }).then(async () => {
                            if (chunkIndex === 0) {
                                await fs.promises.rm(tmpFilePath, { force: true }).catch(() => { });
                            }
                            if (isBinary) {
                                await fs.promises.appendFile(tmpFilePath, Buffer.from(chunk, "base64"));
                            }
                            else {
                                await fs.promises.appendFile(tmpFilePath, chunk, "utf-8");
                            }
                            if (chunkIndex === totalChunks - 1) {
                                if (remoteHash) {
                                    const assembled = await fs.promises.readFile(tmpFilePath);
                                    const assembledHash = computeMeshContentHash(assembled, isBinary);
                                    if (assembledHash !== remoteHash) {
                                        logger.warn(`Rejected assembled chunked file ${filePath} from ${peerName}: hash mismatch ${assembledHash} != ${remoteHash}`);
                                        await fs.promises.rm(tmpFilePath, { force: true }).catch(() => { });
                                        sendFileRejected(peerName, filePath, "hash_mismatch", remoteHash);
                                        notify({
                                            type: "sync_failed",
                                            message: `Rejected '${filePath}' from '${peerName}' because the assembled file hash did not match.`,
                                            peerName,
                                            filePath,
                                            data: { file: filePath, reason: "hash_mismatch", expectedHash: remoteHash, actualHash: assembledHash },
                                        });
                                        return;
                                    }
                                }
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
                                    return;
                                }
                                if (fileWriter) {
                                    if (ignoreNextChangeFn)
                                        ignoreNextChangeFn(filePath);
                                    await fileWriter(filePath, tmpFilePath, isBinary, true);
                                    syncState.recordRemoteChange(filePath, remoteHash || "", peerName, isBinary);
                                    logger.info(`Wrote received chunked file to disk: ${filePath} from ${peerName}`);
                                    sendToPeer(peerName, {
                                        type: "file_applied",
                                        path: filePath,
                                        hash: remoteHash,
                                        from: nodeName,
                                        appliedAt: Date.now(),
                                    });
                                    notify({
                                        type: "file_received",
                                        message: `Received '${filePath}' from '${peerName}'.`,
                                        peerName,
                                        filePath,
                                        data: { file: filePath, isBinary, direction: "pull" },
                                    });
                                }
                                await fs.promises.rm(tmpFilePath, { force: true }).catch(() => { });
                            }
                        });
                        chunkAssemblyQueues.set(chunkAssemblyKey, currentAssembly);
                        void currentAssembly.finally(() => {
                            if (chunkAssemblyQueues.get(chunkAssemblyKey) === currentAssembly) {
                                chunkAssemblyQueues.delete(chunkAssemblyKey);
                            }
                        }).catch(() => { });
                        try {
                            await currentAssembly;
                        }
                        catch (err) {
                            logger.error(`Failed to assemble file chunk for ${filePath}: ${err}`);
                            sendFileRejected(peerName, filePath, "chunk_assembly_failed", remoteHash);
                            await fs.promises.rm(tmpFilePath, { force: true }).catch(() => { });
                        }
                    }
                    break;
                case "file_content":
                    if (!approved)
                        return;
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
                            }
                            catch (err) {
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
                        }
                        else {
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
                case "file_patch":
                    if (!approved)
                        return;
                    {
                        const { path: rawPath, patch: rawPatch, parentHash, targetHash, from, compressed } = message;
                        const safePath = normalizeRelativePath(typeof rawPath === "string" ? rawPath : "");
                        if (!safePath || !parentHash || !targetHash || !rawPatch) {
                            logger.warn(`Received invalid file_patch payload for ${invalidPathLabel(rawPath)} from ${peerName}`);
                            break;
                        }
                        let patch = rawPatch;
                        if (compressed) {
                            try {
                                patch = zlib.gunzipSync(Buffer.from(rawPatch, "base64")).toString("utf-8");
                            }
                            catch (err) {
                                logger.error(`Failed to decompress patch for ${safePath}: ${err}`);
                                syncStats.fallbackFullSyncs++;
                                logger.info(`Fallback full sync requested for ${safePath} from ${peerName}. Fallback sync count: ${syncStats.fallbackFullSyncs}`);
                                sendToPeer(peerName, {
                                    type: "file_content_request",
                                    path: safePath,
                                    from: nodeName,
                                });
                                break;
                            }
                        }
                        logger.info(`Received patch for ${safePath} from ${peerName} (parent: ${parentHash}, target: ${targetHash})`);
                        if (syncState.isConflict(safePath, parentHash) && !syncState.consumeForceAllow(safePath)) {
                            logger.warn(`Conflict: ${safePath} — local has modifications and remote has different version. Keeping local.`);
                            sendFileRejected(peerName, safePath, "conflict", targetHash);
                            notify({
                                type: "file_conflict",
                                message: `Conflict on '${safePath}' from '${peerName}': both sides modified this file. Your local version was kept. Use 'pull ${safePath} from ${peerName}' to override.`,
                                peerName,
                                filePath: safePath,
                                data: { file: safePath, remotePeer: peerName },
                            });
                            break;
                        }
                        try {
                            const localHash = syncState.getLocalHash(safePath);
                            if (localHash !== parentHash) {
                                throw new Error(`Hash mismatch: local is ${localHash || "missing"}, patch requires ${parentHash}`);
                            }
                            if (!fileContentProvider || !fileWriter) {
                                throw new Error("Missing providers or writers");
                            }
                            const fileData = await fileContentProvider(safePath);
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
                                ignoreNextChangeFn(safePath);
                            }
                            await fileWriter(safePath, reconstructed, false);
                            syncState.recordRemoteChange(safePath, targetHash, from || peerName, false);
                            logger.info(`Patch applied successfully to ${safePath} (${reconstructedHash})`);
                            sendToPeer(peerName, {
                                type: "file_applied",
                                path: safePath,
                                hash: targetHash,
                                from: nodeName,
                                appliedAt: Date.now(),
                            });
                            notify({
                                type: "file_written",
                                message: `Patch applied successfully to '${safePath}' from '${peerName}'.`,
                                peerName,
                                filePath: safePath,
                                data: { file: safePath, isBinary: false, direction: "received", patched: true },
                            });
                        }
                        catch (err) {
                            logger.warn(`Patch verification failed for ${safePath}: ${err}`);
                            syncStats.fallbackFullSyncs++;
                            logger.info(`Fallback full sync requested for ${safePath} from ${peerName}. Fallback sync count: ${syncStats.fallbackFullSyncs}`);
                            sendToPeer(peerName, {
                                type: "file_content_request",
                                path: safePath,
                                from: nodeName,
                            });
                        }
                    }
                    break;
                case "file_preview_request":
                    if (!approved)
                        return;
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
                        }
                        else {
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
                    if (!approved)
                        return;
                    {
                        if (typeof message.requestId !== "string") {
                            rejectValidation(peerName, { ok: false, reason: "invalid_message", detail: "requestId must be a string" });
                            break;
                        }
                        const request = previewRequests.get(message.requestId);
                        if (!request)
                            return;
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
                        }
                        else {
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
                    if (!approved)
                        return;
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
                            }
                            else {
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
                    if (!approved)
                        return;
                    {
                        const validation = validateFileApplied(message);
                        if (!validation.ok) {
                            rejectValidation(peerName, validation);
                            break;
                        }
                        const record = {
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
                    if (!approved)
                        return;
                    {
                        const validation = validateFileRejected(message);
                        if (!validation.ok) {
                            rejectValidation(peerName, validation);
                            break;
                        }
                        const record = {
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
                    if (!approved)
                        return;
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
                    if (!approved)
                        return;
                    logger.debug(`Received legacy 'delta' message — ignoring. Peer should use file_content instead.`);
                    break;
                case "sync_request":
                case "sync_response":
                    if (!approved)
                        return;
                    logger.debug(`Received legacy '${message.type}' message — ignoring.`);
                    break;
                case "capability_execute":
                    if (!approved)
                        return;
                    {
                        const validation = validateCapabilityExecute(message);
                        if (!validation.ok) {
                            rejectValidation(peerName, validation);
                            break;
                        }
                        const request = validation.value;
                        const requestId = request.requestId || createExecutionRequestId();
                        storePendingExecution({
                            requestId,
                            peerName,
                            direction: "incoming",
                            capability: request.capability,
                            instruction: request.instruction,
                            from: request.from,
                        });
                        logger.info(`Pending capability execution ${requestId} from ${peerName}: ${request.capability}`);
                    }
                    break;
                case "capability_execute_result":
                    if (!approved)
                        return;
                    {
                        const validation = validateCapabilityExecuteResult(message);
                        if (!validation.ok) {
                            rejectValidation(peerName, validation);
                            break;
                        }
                        completePendingExecution(validation.value.requestId, {
                            result: validation.value.result,
                            error: validation.value.error,
                            from: validation.value.from || peerName,
                        }, peerName);
                    }
                    break;
                default:
                    logger.warn(`Unknown message type from ${peerName}: ${message.type}`);
            }
        }
        catch (err) {
            logger.error(`Failed to handle message from ${peerName}: ${err}`);
        }
    };
    const sendNodeInfoToPeer = (peerName) => {
        if (nodeInfoProvider) {
            const info = nodeInfoProvider();
            sendToPeer(peerName, {
                type: "node_info",
                nodeName: info.nodeName,
                trackingDir: info.trackingDir,
                trackingFileCount: info.trackingFileCount,
                trackingFiles: info.trackingFiles,
                capabilities: info.capabilities,
            });
            logger.info(`Sent node_info to ${peerName}`);
        }
    };
    const exchangePeerState = (peerName) => {
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
    const sendToPeer = (peerName, message) => {
        const conn = connections.get(peerName);
        const pending = pendingConnections.get(peerName);
        if (conn && conn.transport.isOpen()) {
            conn.transport.send(JSON.stringify(message));
        }
        else if (pending && pending.transport.isOpen()) {
            pending.transport.send(JSON.stringify(message));
        }
    };
    const setupTransport = (transport, peerName, isIncoming) => {
        transport.onMessage((raw) => {
            if (isRawMessageTooLarge(Buffer.byteLength(raw))) {
                logger.warn(`[${transport.type.toUpperCase()}] Rejected oversized raw message from ${peerName}: ${Buffer.byteLength(raw)} bytes`);
                notifyInvalidMessage(peerName, "raw message exceeds limit");
                return;
            }
            if (raw === "__ping__") {
                if (transport.isOpen())
                    transport.send("__pong__");
                return;
            }
            if (raw === "__pong__") {
                const conn = connections.get(peerName);
                if (conn)
                    conn.isAlive = true;
                return;
            }
            const pending = pendingConnections.get(peerName);
            if (pending) {
                handleMessage(peerName, raw, false);
            }
            else {
                const conn = connections.get(peerName);
                if (conn && conn.approved) {
                    handleMessage(peerName, raw, true);
                }
            }
        });
        transport.onDisconnect(() => {
            pendingConnections.delete(peerName);
            challengeNonces.delete(peerName);
            remoteManifests.delete(peerName);
            remoteNodeInfo.delete(peerName);
            remoteAppliedFiles.delete(peerName);
            remoteRejectedFiles.delete(peerName);
            peerTrustWarnings.delete(peerName);
            if (connections.has(peerName)) {
                connections.delete(peerName);
                notify({
                    type: "peer_disconnected",
                    message: `Peer '${peerName}' disconnected (${connections.size} remaining).`,
                    peerName,
                });
            }
            logger.info(`[${transport.type.toUpperCase()}] Peer disconnected: ${peerName} (${connections.size} remaining)`);
        });
        transport.onError((err) => {
            logger.error(`[${transport.type.toUpperCase()}] Connection error with ${peerName}: ${err}`);
            pendingConnections.delete(peerName);
            connections.delete(peerName);
        });
    };
    return {
        async start() {
            try {
                const { WebSocketServer } = await import("ws");
                server = new WebSocketServer({ port });
                server.on("connection", (socket, req) => {
                    const transport = new WebSocketTransport(socket);
                    const peerName = req.headers["x-mesh-node"] || "unknown";
                    const host = normalizePeerHost(req.socket.remoteAddress || "unknown");
                    logger.info(`[LAN] Incoming connection from: ${peerName} at ${host}`);
                    if (peerName === nodeName) {
                        logger.warn(`Rejecting self mesh connection from ${peerName} at ${host}`);
                        transport.close();
                        return;
                    }
                    const alreadyConnected = connections.has(peerName);
                    if (alreadyConnected) {
                        const old = connections.get(peerName);
                        old.transport.close();
                        connections.delete(peerName);
                    }
                    const pending = {
                        peerName,
                        transport,
                        host,
                        connectedAt: Date.now(),
                        direction: "incoming",
                        fingerprint: typeof req.headers["x-mesh-fingerprint"] === "string" ? req.headers["x-mesh-fingerprint"] : undefined,
                        publicKey: decodePublicKeyFromWire(req.headers["x-mesh-public-key"]) || undefined,
                        identityVerified: false,
                        transportType: "lan",
                        source: "transport",
                    };
                    pendingConnections.set(peerName, pending);
                    setupTransport(transport, peerName, true);
                    sendIdentityChallenge(peerName, transport);
                });
                logger.info(`Mesh transport server started on port ${port}`);
                keepaliveTimer = setInterval(() => {
                    for (const [name, conn] of connections) {
                        if (!conn.isAlive) {
                            logger.warn(`Peer ${name} missed ping, closing connection`);
                            conn.transport.close();
                            connections.delete(name);
                            notify({
                                type: "peer_disconnected",
                                message: `Peer '${name}' disconnected (missed ping, ${connections.size} remaining).`,
                                peerName: name,
                            });
                            continue;
                        }
                        conn.isAlive = false;
                        if (conn.transport.isOpen()) {
                            conn.transport.send("__ping__");
                        }
                    }
                }, PING_INTERVAL_MS);
            }
            catch (err) {
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
            for (const [, execution] of pendingExecutions) {
                clearTimeout(execution.timer);
            }
            pendingExecutions.clear();
            for (const [, conn] of connections) {
                conn.transport.close();
            }
            connections.clear();
            for (const [, pending] of pendingConnections) {
                pending.transport.close();
            }
            pendingConnections.clear();
            if (server) {
                await new Promise((resolve) => {
                    server.close(() => {
                        logger.info("Transport server stopped");
                        resolve();
                    });
                });
            }
        },
        async connectToPeer(peer) {
            const normalizedHost = normalizePeerHost(peer.host);
            if (peer.name === nodeName || (isLocalIPv4Address(normalizedHost) && peer.port === port)) {
                logger.warn(`Refusing to connect mesh node to itself: ${peer.name} at ${peer.host}:${peer.port}`);
                return false;
            }
            if (connections.has(peer.name))
                return true;
            if (pendingConnections.has(peer.name))
                return true;
            if (peer.source === "signaling" || peer.host === "remote") {
                if (webRTCDialer) {
                    logger.info(`[WEBRTC] Delegating dial for signaling peer: ${peer.name}`);
                    return await webRTCDialer(peer.name);
                }
                else {
                    logger.warn(`Cannot dial signaling peer ${peer.name}: no webRTCDialer registered`);
                    return false;
                }
            }
            try {
                const wsModule = await import("ws");
                const ws = new wsModule.default(`ws://${normalizedHost}:${peer.port}`, {
                    headers: {
                        "x-mesh-node": nodeName,
                        "x-mesh-fingerprint": identity.fingerprint,
                        "x-mesh-public-key": encodePublicKeyForWire(identity.publicKey),
                    },
                });
                await new Promise((resolve, reject) => {
                    ws.on("open", () => {
                        const transport = new WebSocketTransport(ws);
                        const pending = {
                            peerName: peer.name,
                            transport,
                            host: normalizedHost,
                            connectedAt: Date.now(),
                            direction: "outgoing",
                            identityVerified: false,
                            transportType: "lan",
                            source: peer.source || "mdns",
                        };
                        pendingConnections.set(peer.name, pending);
                        setupTransport(transport, peer.name, false);
                        sendIdentityChallenge(peer.name, transport);
                        logger.info(`[LAN] Connected to peer (awaiting identity proof): ${peer.name} at ${normalizedHost}:${peer.port}`);
                        resolve();
                    });
                    ws.on("error", (err) => {
                        logger.error(`Failed to connect to ${peer.name}: ${err}`);
                        reject(err);
                    });
                });
                return true;
            }
            catch (err) {
                logger.error(`Connection to ${peer.name} failed: ${err}`);
                return false;
            }
        },
        registerExternalTransport(peerName, transport, direction, source, host = "remote") {
            if (connections.has(peerName)) {
                logger.warn(`Rejecting duplicate external transport for ${peerName}`);
                transport.close();
                return;
            }
            const existingPending = pendingConnections.get(peerName);
            if (existingPending) {
                // If we already have an outgoing WebRTC request and this is incoming, or vice versa, the protocol naturally prevents dual connections later,
                // but it's safer to close the incoming one if we are already pending an outgoing one, to prevent crossed wires.
                // For now, if we have a pending connection, we keep it and reject the new one to prevent dual transports.
                logger.warn(`Peer ${peerName} already pending, rejecting new external transport.`);
                transport.close();
                return;
            }
            const pending = {
                peerName,
                transport,
                host,
                connectedAt: Date.now(),
                direction,
                identityVerified: false,
                transportType: transport.type,
                source,
            };
            pendingConnections.set(peerName, pending);
            setupTransport(transport, peerName, direction === "incoming");
            sendIdentityChallenge(peerName, transport);
            if (direction === "outgoing") {
                logger.info(`[${transport.type.toUpperCase()}] Connected to external peer (awaiting identity proof): ${peerName}`);
            }
            else {
                logger.info(`[${transport.type.toUpperCase()}] Accepted external peer connection (awaiting identity proof): ${peerName}`);
            }
        },
        setWebRTCDialer(dialer) {
            webRTCDialer = dialer;
        },
        broadcast(message) {
            const data = JSON.stringify(message);
            let sent = 0;
            for (const [, conn] of connections) {
                if (conn.approved && conn.transport.isOpen()) {
                    conn.transport.send(data);
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
        approveConnection(peerName) {
            const pending = pendingConnections.get(peerName);
            if (!pending)
                return false;
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
        denyConnection(peerName) {
            const pending = pendingConnections.get(peerName);
            if (!pending)
                return false;
            if (pending.direction !== "incoming") {
                logger.warn(`Refusing to deny outbound connection request locally: ${peerName}`);
                return false;
            }
            sendToPeer(peerName, {
                type: "approval_response",
                approved: false,
                node: nodeName,
            });
            pending.transport.close();
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
        getRemoteManifest(peerName) {
            return remoteManifests.get(peerName) || null;
        },
        requestManifest(peerName) {
            sendToPeer(peerName, { type: "manifest_request", from: nodeName });
        },
        async sendFileContent(peerName, relativePath, content, isBinary) {
            const safeRelativePath = normalizeRelativePath(relativePath);
            if (!safeRelativePath) {
                logger.warn(`Refusing to send unsafe file path to ${peerName}: ${relativePath}`);
                return;
            }
            const localHash = syncState.getLocalHash(safeRelativePath);
            let patchSent = false;
            if (!isBinary && localHash) {
                try {
                    // Look up what hash we last sent to this peer for this file.
                    // If we find it, read the shadow content from disk and diff locally —
                    // no network round-trip to the peer needed.
                    const lastSentHash = syncState.getLastSentHashToPeer(peerName, safeRelativePath);
                    const oldContent = lastSentHash ? shadowStore.read(lastSentHash) : null;
                    if (oldContent !== null) {
                        if (lastSentHash === localHash) {
                            // Content hasn't changed since last send — nothing to do.
                            logger.info(`Skipping send of ${safeRelativePath} to ${peerName}: content unchanged since last send`);
                            return;
                        }
                        const { createPatchPayload } = await import("./diff-engine.js");
                        const patchPayload = createPatchPayload(safeRelativePath, oldContent, content, lastSentHash, localHash);
                        if (patchPayload && patchPayload.patch) {
                            // DISABLED: this.sendFilePatch(peerName, safeRelativePath, patchPayload.patch, patchPayload.parentHash, patchPayload.targetHash);
                            // logger.info(`Generated patch for ${safeRelativePath} → ${peerName}. Patch size: ${Buffer.byteLength(patchPayload.patch, "utf-8")} bytes (shadow-based, no round-trip)`);
                            // patchSent = true;
                        }
                    }
                    else {
                        logger.info(`No shadow found for ${safeRelativePath} → ${peerName}; will send full file and cache shadow for future diffs`);
                    }
                }
                catch (err) {
                    logger.warn(`Failed to generate shadow-based patch for ${safeRelativePath}: ${err}`);
                }
            }
            if (patchSent) {
                // Save the new content as a shadow for future diffs to this peer.
                if (localHash) {
                    shadowStore.write(localHash, content);
                    syncState.recordSentToPeer(peerName, safeRelativePath, localHash);
                }
                inFlightSends.set(`${peerName}:${safeRelativePath}`, {
                    peerName,
                    path: safeRelativePath,
                    hash: localHash || undefined,
                    sentAt: Date.now(),
                });
            }
            else {
                if (!isBinary) {
                    syncStats.fallbackFullSyncs++;
                    logger.info(`Fallback to full sync for ${safeRelativePath} → ${peerName}. Fallback sync count: ${syncStats.fallbackFullSyncs}`);
                }
                // 1 MiB keeps each WebSocket JSON payload below the raw-message cap.
                // It is also divisible by 4, so base64 binary chunks remain decodable.
                const CHUNK_SIZE = 1024 * 1024;
                const totalChunks = Math.ceil(content.length / CHUNK_SIZE) || 1;
                for (let i = 0; i < totalChunks; i++) {
                    const chunk = content.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                    sendToPeer(peerName, {
                        type: "file_chunk",
                        path: safeRelativePath,
                        chunkIndex: i,
                        totalChunks,
                        chunk,
                        isBinary,
                        hash: localHash,
                        from: nodeName,
                    });
                    // Yield to event loop to prevent freezing on huge files
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
                // After the first full send, save a shadow so the NEXT change to this
                // file can be sent as a patch instead of another full file.
                if (localHash && !isBinary) {
                    shadowStore.write(localHash, content);
                    syncState.recordSentToPeer(peerName, safeRelativePath, localHash);
                }
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
            }
        },
        sendFilePatch(peerName, relativePath, patch, parentHash, targetHash) {
            const safeRelativePath = normalizeRelativePath(relativePath);
            if (!safeRelativePath) {
                logger.warn(`Refusing to send patch for unsafe file path to ${peerName}: ${relativePath}`);
                return;
            }
            let compressedPayload = null;
            try {
                const compressedBuffer = zlib.gzipSync(patch);
                compressedPayload = compressedBuffer.toString("base64");
            }
            catch (err) {
                logger.error(`Failed to compress patch for ${safeRelativePath}: ${err}`);
                syncStats.fallbackFullSyncs++;
                logger.info(`Fallback full sync requested for ${safeRelativePath} from ${peerName}. Fallback sync count: ${syncStats.fallbackFullSyncs}`);
                sendToPeer(peerName, {
                    type: "file_content_request",
                    path: safeRelativePath,
                    from: nodeName,
                });
                return;
            }
            const originalBytes = Buffer.byteLength(patch, "utf-8");
            const compressedBytes = compressedPayload.length;
            syncStats.patchSyncs++;
            syncStats.patchBytesOriginal += originalBytes;
            syncStats.patchBytesCompressed += compressedBytes;
            const savedBytes = originalBytes - compressedBytes;
            const savedPercent = originalBytes > 0 ? Math.round((savedBytes / originalBytes) * 100) : 0;
            logger.info(`Patch compressed: ${originalBytes} -> ${compressedBytes} bytes. Saved ${savedPercent}% transfer size.`);
            sendToPeer(peerName, {
                type: "file_patch",
                path: safeRelativePath,
                patch: compressedPayload,
                compressed: true,
                parentHash,
                targetHash,
                from: nodeName,
            });
            logger.info(`Sent file patch for '${safeRelativePath}' to '${peerName}'`);
            notify({
                type: "file_patch",
                message: `Sent patch for '${safeRelativePath}' to '${peerName}'.`,
                peerName,
                filePath: safeRelativePath,
                data: { file: safeRelativePath, parentHash, targetHash, direction: "push" },
            });
        },
        requestFileContent(peerName, relativePath) {
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
        requestFilePreview(peerName, relativePath, timeoutMs = 5000) {
            const safeRelativePath = normalizeRelativePath(relativePath);
            if (!safeRelativePath) {
                logger.warn(`Refusing to preview unsafe file path from ${peerName}: ${relativePath}`);
                return Promise.resolve(null);
            }
            const conn = connections.get(peerName);
            if (!conn || !conn.approved || !conn.transport.isOpen()) {
                return Promise.resolve(null);
            }
            const requestId = `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            return new Promise((resolve) => {
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
        sendLocalManifest(peerName, manifest) {
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
        notifyFileDeleted(relativePath) {
            const safeRelativePath = normalizeRelativePath(relativePath);
            if (!safeRelativePath) {
                logger.warn(`Refusing to notify deletion for unsafe file path: ${relativePath}`);
                return;
            }
            const msg = { type: "file_deleted", path: safeRelativePath, from: nodeName };
            const data = JSON.stringify(msg);
            for (const [, conn] of connections) {
                if (conn.approved && conn.transport.isOpen()) {
                    conn.transport.send(data);
                }
            }
        },
        broadcastNodeInfo() {
            for (const [peerName, conn] of connections) {
                if (conn.approved && conn.transport.isOpen()) {
                    sendNodeInfoToPeer(peerName);
                }
            }
        },
        setNotificationHandler(handler) {
            notificationHandler = handler;
        },
        async maintainConnections() {
            for (const [name, conn] of connections) {
                if (!conn.transport.isOpen()) {
                    connections.delete(name);
                    notify({
                        type: "peer_disconnected",
                        message: `Peer '${name}' disconnected (${connections.size} remaining).`,
                        peerName: name,
                    });
                }
            }
        },
        getNodeInfo(peerName) {
            return remoteNodeInfo.get(peerName) || null;
        },
        getRemoteAppliedFiles(peerName) {
            return [...(remoteAppliedFiles.get(peerName) || [])];
        },
        getRemoteRejectedFiles(peerName) {
            return [...(remoteRejectedFiles.get(peerName) || [])];
        },
        getInFlightSends(peerName) {
            const records = [...inFlightSends.values()];
            return peerName ? records.filter((record) => record.peerName === peerName) : records;
        },
        getPendingExecutions(peerName) {
            const records = [...pendingExecutions.values()].map(publicPendingExecution);
            return peerName ? records.filter((record) => record.peerName === peerName) : records;
        },
        sendCapabilityExecute(peerName, capability, instruction, requestId) {
            const conn = connections.get(peerName);
            if (!conn?.approved || !conn.transport.isOpen()) {
                logger.warn(`Cannot send capability execution to '${peerName}': peer is not connected and approved.`);
                return null;
            }
            const executionRequestId = requestId || createExecutionRequestId();
            storePendingExecution({
                requestId: executionRequestId,
                peerName,
                direction: "outgoing",
                capability,
                instruction,
                from: nodeName,
            });
            sendToPeer(peerName, {
                type: "capability_execute",
                requestId: executionRequestId,
                capability,
                instruction,
                from: nodeName,
            });
            return executionRequestId;
        },
        respondToExecution(requestId, result, error) {
            const execution = pendingExecutions.get(requestId);
            if (!execution || execution.direction !== "incoming") {
                logger.warn(`Cannot respond to capability execution '${requestId}': no incoming pending execution found.`);
                return false;
            }
            const conn = connections.get(execution.peerName);
            if (!conn?.approved || !conn.transport.isOpen()) {
                logger.warn(`Cannot respond to capability execution '${requestId}': peer '${execution.peerName}' is not connected and approved.`);
                return false;
            }
            sendToPeer(execution.peerName, {
                type: "capability_execute_result",
                requestId,
                result,
                error,
                from: nodeName,
            });
            return completePendingExecution(requestId, { result, error, from: nodeName });
        },
        getPeerFingerprint(peerName) {
            return connections.get(peerName)?.fingerprint || pendingConnections.get(peerName)?.fingerprint || null;
        },
        getPeerTrustWarning(peerName) {
            return peerTrustWarnings.get(peerName) || null;
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
        setIgnoreNextChange(fn) {
            ignoreNextChangeFn = fn;
        },
    };
}
