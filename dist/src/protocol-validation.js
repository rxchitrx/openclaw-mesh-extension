import { normalizeRelativePath } from "./path-safety.js";
export const MAX_RAW_MESSAGE_BYTES = 12 * 1024 * 1024;
export const MAX_FILE_CONTENT_BYTES = 10 * 1024 * 1024;
export const MAX_PREVIEW_CONTENT_BYTES = 2 * 1024 * 1024;
export const MAX_MANIFEST_FILES = 5000;
export const MAX_PATH_LENGTH = 512;
export const MAX_STRING_FIELD_LENGTH = 1024;
export const MAX_CAPABILITY_INSTRUCTION_LENGTH = 16 * 1024;
const MESH_MESSAGE_TYPES = new Set([
    "approval_request",
    "approval_response",
    "identity_challenge",
    "identity_proof",
    "node_info",
    "manifest",
    "manifest_request",
    "file_content",
    "file_chunk",
    "file_preview_request",
    "file_preview_response",
    "file_content_request",
    "file_applied",
    "file_rejected",
    "file_deleted",
    "delta",
    "sync_request",
    "sync_response",
    "capability_execute",
    "capability_execute_result",
]);
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function fail(reason, detail) {
    return { ok: false, reason, detail };
}
function boundedString(value, field, maxLength = MAX_STRING_FIELD_LENGTH) {
    if (value === undefined || value === null)
        return { ok: true, value: undefined };
    if (typeof value !== "string")
        return fail("invalid_message", `${field} must be a string`);
    if (value.length > maxLength)
        return fail("invalid_message", `${field} is too long`);
    return { ok: true, value };
}
function requiredString(value, field, maxLength = MAX_STRING_FIELD_LENGTH) {
    const result = boundedString(value, field, maxLength);
    if (!result.ok)
        return result;
    if (!result.value)
        return fail("invalid_message", `${field} is required`);
    return { ok: true, value: result.value };
}
function safePath(value) {
    const path = normalizeRelativePath(value);
    if (!path)
        return fail("invalid_message", "path is invalid");
    if (path.length > MAX_PATH_LENGTH)
        return fail("invalid_message", "path is too long");
    return { ok: true, value: path };
}
function optionalHash(value) {
    const result = boundedString(value, "hash", 128);
    if (!result.ok)
        return result;
    return { ok: true, value: result.value };
}
function optionalStringArray(value, field, maxItems, maxStringLength = MAX_STRING_FIELD_LENGTH) {
    if (value === undefined || value === null)
        return { ok: true, value: [] };
    if (!Array.isArray(value))
        return fail("invalid_message", `${field} must be an array`);
    const strings = [];
    for (const item of value) {
        if (strings.length >= maxItems)
            break;
        if (typeof item !== "string")
            return fail("invalid_message", `${field} must contain only strings`);
        if (item.length > maxStringLength)
            return fail("invalid_message", `${field} contains a string that is too long`);
        const normalized = item.trim();
        if (normalized.length > 0) {
            strings.push(normalized);
        }
    }
    return { ok: true, value: strings };
}
function stringByteLength(value) {
    return Buffer.byteLength(value, "utf-8");
}
export function parseMeshMessage(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return fail("invalid_message", "message is not valid JSON");
    }
    if (!isRecord(parsed))
        return fail("invalid_message", "message must be an object");
    if (typeof parsed.type !== "string" || !MESH_MESSAGE_TYPES.has(parsed.type)) {
        return fail("invalid_message", "unknown message type");
    }
    return { ok: true, value: parsed };
}
export function isRawMessageTooLarge(byteLength) {
    return byteLength > MAX_RAW_MESSAGE_BYTES;
}
export function validateApprovalResponse(message) {
    if (message.approved !== true && message.approved !== false) {
        return fail("invalid_message", "approved must be a boolean");
    }
    return { ok: true, value: { type: "approval_response", approved: message.approved } };
}
export function validateNodeInfo(message) {
    const nodeName = requiredString(message.nodeName, "nodeName");
    if (!nodeName.ok)
        return nodeName;
    const trackingDir = boundedString(message.trackingDir, "trackingDir");
    if (!trackingDir.ok)
        return trackingDir;
    const trackingFiles = Array.isArray(message.trackingFiles)
        ? message.trackingFiles.filter((file) => typeof file === "string" && file.length <= MAX_PATH_LENGTH).slice(0, MAX_MANIFEST_FILES)
        : [];
    const trackingFileCount = typeof message.trackingFileCount === "number" && Number.isFinite(message.trackingFileCount) && message.trackingFileCount >= 0
        ? message.trackingFileCount
        : trackingFiles.length;
    const capabilities = optionalStringArray(message.capabilities, "capabilities", 256);
    if (!capabilities.ok)
        return capabilities;
    return {
        ok: true,
        value: {
            type: "node_info",
            nodeName: nodeName.value,
            trackingDir: trackingDir.value || null,
            trackingFileCount,
            trackingFiles,
            capabilities: capabilities.value,
        },
    };
}
export function validateManifest(message) {
    if (!Array.isArray(message.files))
        return fail("invalid_message", "files must be an array");
    const files = [];
    let droppedEntries = 0;
    for (const entry of message.files) {
        if (files.length >= MAX_MANIFEST_FILES) {
            droppedEntries += 1;
            continue;
        }
        if (!isRecord(entry)) {
            droppedEntries += 1;
            continue;
        }
        const relativePath = normalizeRelativePath(entry.relativePath);
        const validPath = relativePath && relativePath.length <= MAX_PATH_LENGTH;
        const hash = entry.hash;
        const size = entry.size;
        const validHash = typeof hash === "string" && hash.length > 0 && hash.length <= 128;
        const validSize = typeof size === "number" && Number.isFinite(size) && size >= 0 && size <= Number.MAX_SAFE_INTEGER;
        if (!validPath || !validHash || !validSize) {
            droppedEntries += 1;
            continue;
        }
        files.push({
            relativePath,
            hash,
            size,
            isBinary: entry.isBinary === true,
        });
    }
    return { ok: true, value: { type: "manifest", files, droppedEntries } };
}
export function validateFileContent(message) {
    const path = safePath(message.path);
    if (!path.ok)
        return path;
    if (typeof message.content !== "string")
        return fail("invalid_message", "content must be a string");
    if (stringByteLength(message.content) > MAX_FILE_CONTENT_BYTES)
        return fail("payload_too_large", "file content exceeds limit");
    if (message.isBinary !== true && message.isBinary !== false)
        return fail("invalid_message", "isBinary must be a boolean");
    const hash = optionalHash(message.hash);
    if (!hash.ok)
        return hash;
    return {
        ok: true,
        value: {
            type: "file_content",
            path: path.value,
            content: message.content,
            isBinary: message.isBinary,
            hash: hash.value,
        },
    };
}
export function validateFileChunk(message) {
    const path = safePath(message.path);
    if (!path.ok)
        return path;
    const chunkIndex = message.chunkIndex;
    const totalChunks = message.totalChunks;
    if (typeof chunkIndex !== "number" || !Number.isInteger(chunkIndex))
        return fail("invalid_message", "chunkIndex must be an integer");
    if (typeof totalChunks !== "number" || !Number.isInteger(totalChunks))
        return fail("invalid_message", "totalChunks must be an integer");
    if (totalChunks <= 0)
        return fail("invalid_message", "totalChunks must be positive");
    if (chunkIndex < 0)
        return fail("invalid_message", "chunkIndex must be non-negative");
    if (chunkIndex >= totalChunks)
        return fail("invalid_message", "chunkIndex must be less than totalChunks");
    if (typeof message.chunk !== "string")
        return fail("invalid_message", "chunk must be a string");
    if (stringByteLength(message.chunk) > MAX_RAW_MESSAGE_BYTES)
        return fail("payload_too_large", "chunk exceeds raw message limit");
    if (message.isBinary !== true && message.isBinary !== false)
        return fail("invalid_message", "isBinary must be a boolean");
    const hash = optionalHash(message.hash);
    if (!hash.ok)
        return hash;
    return {
        ok: true,
        value: {
            type: "file_chunk",
            path: path.value,
            chunkIndex,
            totalChunks,
            chunk: message.chunk,
            isBinary: message.isBinary,
            hash: hash.value,
        },
    };
}
export function validateFilePathMessage(message, type) {
    const path = safePath(message.path);
    if (!path.ok)
        return path;
    return { ok: true, value: { type, path: path.value } };
}
export function validateFilePreviewRequest(message) {
    const requestId = requiredString(message.requestId, "requestId");
    if (!requestId.ok)
        return requestId;
    const path = safePath(message.path);
    if (!path.ok)
        return path;
    return { ok: true, value: { type: "file_preview_request", requestId: requestId.value, path: path.value } };
}
export function validateFilePreviewResponse(message) {
    const requestId = requiredString(message.requestId, "requestId");
    if (!requestId.ok)
        return requestId;
    const path = safePath(message.path);
    if (!path.ok)
        return path;
    const error = boundedString(message.error, "error");
    if (!error.ok)
        return error;
    const hash = optionalHash(message.hash);
    if (!hash.ok)
        return hash;
    if (error.value) {
        return { ok: true, value: { type: "file_preview_response", requestId: requestId.value, path: path.value, isBinary: false, hash: hash.value, error: error.value } };
    }
    if (typeof message.content !== "string")
        return fail("invalid_message", "preview content must be a string");
    if (stringByteLength(message.content) > MAX_PREVIEW_CONTENT_BYTES)
        return fail("payload_too_large", "preview content exceeds limit");
    if (message.isBinary !== true && message.isBinary !== false)
        return fail("invalid_message", "isBinary must be a boolean");
    return {
        ok: true,
        value: {
            type: "file_preview_response",
            requestId: requestId.value,
            path: path.value,
            content: message.content,
            isBinary: message.isBinary,
            hash: hash.value,
        },
    };
}
export function validateFileApplied(message) {
    const path = safePath(message.path);
    if (!path.ok)
        return path;
    const hash = optionalHash(message.hash);
    if (!hash.ok)
        return hash;
    const from = boundedString(message.from, "from");
    if (!from.ok)
        return from;
    return {
        ok: true,
        value: {
            type: "file_applied",
            path: path.value,
            hash: hash.value,
            appliedAt: typeof message.appliedAt === "number" && Number.isFinite(message.appliedAt) ? message.appliedAt : Date.now(),
            from: from.value,
        },
    };
}
export function validateFileRejected(message) {
    const path = safePath(message.path);
    if (!path.ok)
        return path;
    const hash = optionalHash(message.hash);
    if (!hash.ok)
        return hash;
    const from = boundedString(message.from, "from");
    if (!from.ok)
        return from;
    const reason = boundedString(message.reason, "reason", 128);
    if (!reason.ok)
        return reason;
    return {
        ok: true,
        value: {
            type: "file_rejected",
            path: path.value,
            hash: hash.value,
            rejectedAt: typeof message.rejectedAt === "number" && Number.isFinite(message.rejectedAt) ? message.rejectedAt : Date.now(),
            from: from.value,
            reason: reason.value || "unknown",
        },
    };
}
export function validateCapabilityExecute(message) {
    const requestId = boundedString(message.requestId, "requestId", 128);
    if (!requestId.ok)
        return requestId;
    const capability = requiredString(message.capability, "capability");
    if (!capability.ok)
        return capability;
    const normalizedCapability = capability.value.trim();
    if (!normalizedCapability)
        return fail("invalid_message", "capability is required");
    const instruction = requiredString(message.instruction, "instruction", MAX_CAPABILITY_INSTRUCTION_LENGTH);
    if (!instruction.ok)
        return instruction;
    const from = requiredString(message.from, "from");
    if (!from.ok)
        return from;
    return {
        ok: true,
        value: {
            type: "capability_execute",
            requestId: requestId.value,
            capability: normalizedCapability,
            instruction: instruction.value,
            from: from.value,
        },
    };
}
export function validateCapabilityExecuteResult(message) {
    const requestId = requiredString(message.requestId, "requestId", 128);
    if (!requestId.ok)
        return requestId;
    const error = boundedString(message.error, "error", MAX_CAPABILITY_INSTRUCTION_LENGTH);
    if (!error.ok)
        return error;
    const from = requiredString(message.from, "from");
    if (!from.ok)
        return from;
    return {
        ok: true,
        value: {
            type: "capability_execute_result",
            requestId: requestId.value,
            result: message.result,
            error: error.value,
            from: from.value,
        },
    };
}
