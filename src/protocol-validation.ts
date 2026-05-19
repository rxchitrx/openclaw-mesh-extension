import type { TrackedFile } from "./file-watcher.js";
import { normalizeRelativePath } from "./path-safety.js";

export const MAX_RAW_MESSAGE_BYTES = 12 * 1024 * 1024;
export const MAX_FILE_CONTENT_BYTES = 10 * 1024 * 1024;
export const MAX_PREVIEW_CONTENT_BYTES = 2 * 1024 * 1024;
export const MAX_MANIFEST_FILES = 5000;
export const MAX_PATH_LENGTH = 512;
export const MAX_STRING_FIELD_LENGTH = 1024;

const MESH_MESSAGE_TYPES = new Set([
  "approval_request",
  "approval_response",
  "identity_challenge",
  "identity_proof",
  "node_info",
  "manifest",
  "manifest_request",
  "file_content",
  "file_preview_request",
  "file_preview_response",
  "file_content_request",
  "file_applied",
  "file_rejected",
  "file_deleted",
  "delta",
  "sync_request",
  "sync_response",
]);

export type ValidationResult<T> = any;

export type BaseMeshMessage = {
  type: string;
};

export type ApprovalResponseMessage = BaseMeshMessage & {
  type: "approval_response";
  approved: boolean;
};

export type NodeInfoMessage = BaseMeshMessage & {
  type: "node_info";
  nodeName: string;
  trackingDir: string | null;
  trackingFileCount: number;
  trackingFiles: string[];
  capabilities: string[];
};

export type ManifestMessage = BaseMeshMessage & {
  type: "manifest";
  files: TrackedFile[];
  droppedEntries: number;
};

export type FileContentMessage = BaseMeshMessage & {
  type: "file_content";
  path: string;
  content: string;
  isBinary: boolean;
  hash?: string;
};

export type FilePathMessage = BaseMeshMessage & {
  path: string;
};

export type FilePreviewRequestMessage = FilePathMessage & {
  type: "file_preview_request";
  requestId: string;
};

export type FilePreviewResponseMessage = FilePathMessage & {
  type: "file_preview_response";
  requestId: string;
  content?: string;
  isBinary: boolean;
  hash?: string;
  error?: string;
};

export type FileAppliedMessage = FilePathMessage & {
  type: "file_applied";
  hash?: string;
  appliedAt: number;
  from?: string;
};

export type FileRejectedMessage = FilePathMessage & {
  type: "file_rejected";
  hash?: string;
  rejectedAt: number;
  from?: string;
  reason: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fail(reason: "invalid_message" | "payload_too_large", detail: string): any {
  return { ok: false, reason, detail };
}

function boundedString(value: unknown, field: string, maxLength = MAX_STRING_FIELD_LENGTH): ValidationResult<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return fail("invalid_message", `${field} must be a string`);
  if (value.length > maxLength) return fail("invalid_message", `${field} is too long`);
  return { ok: true, value };
}

function requiredString(value: unknown, field: string, maxLength = MAX_STRING_FIELD_LENGTH): ValidationResult<string> {
  const result = boundedString(value, field, maxLength);
  if (!result.ok) return result;
  if (!result.value) return fail("invalid_message", `${field} is required`);
  return { ok: true, value: result.value };
}

function safePath(value: unknown): ValidationResult<string> {
  const path = normalizeRelativePath(value);
  if (!path) return fail("invalid_message", "path is invalid");
  if (path.length > MAX_PATH_LENGTH) return fail("invalid_message", "path is too long");
  return { ok: true, value: path };
}

function optionalHash(value: unknown): ValidationResult<string | undefined> {
  const result = boundedString(value, "hash", 128);
  if (!result.ok) return result;
  return { ok: true, value: result.value };
}

function optionalStringArray(value: unknown, field: string, maxItems: number, maxStringLength = MAX_STRING_FIELD_LENGTH): ValidationResult<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return fail("invalid_message", `${field} must be an array`);
  const strings: string[] = [];
  for (const item of value) {
    if (strings.length >= maxItems) break;
    if (typeof item !== "string") return fail("invalid_message", `${field} must contain only strings`);
    if (item.length > maxStringLength) return fail("invalid_message", `${field} contains a string that is too long`);
    const normalized = item.trim();
    if (normalized.length > 0) {
      strings.push(normalized);
    }
  }
  return { ok: true, value: strings };
}

function stringByteLength(value: string): number {
  return Buffer.byteLength(value, "utf-8");
}

export function parseMeshMessage(raw: string): ValidationResult<BaseMeshMessage & Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("invalid_message", "message is not valid JSON");
  }
  if (!isRecord(parsed)) return fail("invalid_message", "message must be an object");
  if (typeof parsed.type !== "string" || !MESH_MESSAGE_TYPES.has(parsed.type)) {
    return fail("invalid_message", "unknown message type");
  }
  return { ok: true, value: parsed as BaseMeshMessage & Record<string, unknown> };
}

export function isRawMessageTooLarge(byteLength: number): boolean {
  return byteLength > MAX_RAW_MESSAGE_BYTES;
}

export function validateApprovalResponse(message: Record<string, unknown>): ValidationResult<ApprovalResponseMessage> {
  if (message.approved !== true && message.approved !== false) {
    return fail("invalid_message", "approved must be a boolean");
  }
  return { ok: true, value: { type: "approval_response", approved: message.approved } };
}

export function validateNodeInfo(message: Record<string, unknown>): ValidationResult<NodeInfoMessage> {
  const nodeName = requiredString(message.nodeName, "nodeName");
  if (!nodeName.ok) return nodeName;

  const trackingDir = boundedString(message.trackingDir, "trackingDir");
  if (!trackingDir.ok) return trackingDir;

  const trackingFiles = Array.isArray(message.trackingFiles)
    ? message.trackingFiles.filter((file): file is string => typeof file === "string" && file.length <= MAX_PATH_LENGTH).slice(0, MAX_MANIFEST_FILES)
    : [];

  const trackingFileCount = typeof message.trackingFileCount === "number" && Number.isFinite(message.trackingFileCount) && message.trackingFileCount >= 0
    ? message.trackingFileCount
    : trackingFiles.length;

  const capabilities = optionalStringArray(message.capabilities, "capabilities", 256);
  if (!capabilities.ok) return capabilities;

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

export function validateManifest(message: Record<string, unknown>): ValidationResult<ManifestMessage> {
  if (!Array.isArray(message.files)) return fail("invalid_message", "files must be an array");

  const files: TrackedFile[] = [];
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

export function validateFileContent(message: Record<string, unknown>): ValidationResult<FileContentMessage> {
  const path = safePath(message.path);
  if (!path.ok) return path;

  if (typeof message.content !== "string") return fail("invalid_message", "content must be a string");
  if (stringByteLength(message.content) > MAX_FILE_CONTENT_BYTES) return fail("payload_too_large", "file content exceeds limit");
  if (message.isBinary !== true && message.isBinary !== false) return fail("invalid_message", "isBinary must be a boolean");

  const hash = optionalHash(message.hash);
  if (!hash.ok) return hash;

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

export function validateFilePathMessage<T extends string>(message: Record<string, unknown>, type: T): ValidationResult<FilePathMessage & { type: T }> {
  const path = safePath(message.path);
  if (!path.ok) return path;
  return { ok: true, value: { type, path: path.value } };
}

export function validateFilePreviewRequest(message: Record<string, unknown>): ValidationResult<FilePreviewRequestMessage> {
  const requestId = requiredString(message.requestId, "requestId");
  if (!requestId.ok) return requestId;
  const path = safePath(message.path);
  if (!path.ok) return path;
  return { ok: true, value: { type: "file_preview_request", requestId: requestId.value, path: path.value } };
}

export function validateFilePreviewResponse(message: Record<string, unknown>): ValidationResult<FilePreviewResponseMessage> {
  const requestId = requiredString(message.requestId, "requestId");
  if (!requestId.ok) return requestId;
  const path = safePath(message.path);
  if (!path.ok) return path;

  const error = boundedString(message.error, "error");
  if (!error.ok) return error;

  const hash = optionalHash(message.hash);
  if (!hash.ok) return hash;

  if (error.value) {
    return { ok: true, value: { type: "file_preview_response", requestId: requestId.value, path: path.value, isBinary: false, hash: hash.value, error: error.value } };
  }

  if (typeof message.content !== "string") return fail("invalid_message", "preview content must be a string");
  if (stringByteLength(message.content) > MAX_PREVIEW_CONTENT_BYTES) return fail("payload_too_large", "preview content exceeds limit");
  if (message.isBinary !== true && message.isBinary !== false) return fail("invalid_message", "isBinary must be a boolean");

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

export function validateFileApplied(message: Record<string, unknown>): ValidationResult<FileAppliedMessage> {
  const path = safePath(message.path);
  if (!path.ok) return path;
  const hash = optionalHash(message.hash);
  if (!hash.ok) return hash;
  const from = boundedString(message.from, "from");
  if (!from.ok) return from;
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

export function validateFileRejected(message: Record<string, unknown>): ValidationResult<FileRejectedMessage> {
  const path = safePath(message.path);
  if (!path.ok) return path;
  const hash = optionalHash(message.hash);
  if (!hash.ok) return hash;
  const from = boundedString(message.from, "from");
  if (!from.ok) return from;
  const reason = boundedString(message.reason, "reason", 128);
  if (!reason.ok) return reason;
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
