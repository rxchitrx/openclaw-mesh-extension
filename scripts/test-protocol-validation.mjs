import assert from "node:assert/strict";

import {
  MAX_FILE_CONTENT_BYTES,
  MAX_MANIFEST_FILES,
  MAX_PATH_LENGTH,
  MAX_PREVIEW_CONTENT_BYTES,
  MAX_RAW_MESSAGE_BYTES,
  isRawMessageTooLarge,
  parseMeshMessage,
  validateNodeInfo,
  validateFileApplied,
  validateFileChunk,
  validateFileContent,
  validateFilePathMessage,
  validateFilePreviewResponse,
  validateFileRejected,
  validateManifest,
  validateCapabilityExecute,
  validateCapabilityExecuteResult,
} from "../dist/src/protocol-validation.js";

const validManifest = validateManifest({
  type: "manifest",
  files: [
    { relativePath: "src/index.ts", hash: "abc123", size: 123, isBinary: false },
    { relativePath: "assets/logo.png", hash: "def456", size: 456, isBinary: true },
  ],
});
assert.equal(validManifest.ok, true);
assert.equal(validManifest.value.files.length, 2);

const validContent = validateFileContent({
  type: "file_content",
  path: "src/index.ts",
  content: "hello",
  isBinary: false,
  hash: "abc123",
});
assert.equal(validContent.ok, true);
assert.equal(validContent.value.path, "src/index.ts");

const validChunkParse = parseMeshMessage(JSON.stringify({
  type: "file_chunk",
  path: "nested/../large.txt",
  chunkIndex: 0,
  totalChunks: 2,
  chunk: "hello",
  isBinary: false,
  hash: "abc123",
}));
assert.equal(validChunkParse.ok, true);

const validChunk = validateFileChunk({
  type: "file_chunk",
  path: "nested/../large.txt",
  chunkIndex: 0,
  totalChunks: 2,
  chunk: "hello",
  isBinary: false,
  hash: "abc123",
});
assert.equal(validChunk.ok, true);
assert.equal(validChunk.value.path, "large.txt");

for (const invalidChunk of [
  { type: "file_chunk", path: "../large.txt", chunkIndex: 0, totalChunks: 1, chunk: "x", isBinary: false },
  { type: "file_chunk", path: "large.txt", chunkIndex: 0.5, totalChunks: 1, chunk: "x", isBinary: false },
  { type: "file_chunk", path: "large.txt", chunkIndex: 0, totalChunks: 0, chunk: "x", isBinary: false },
  { type: "file_chunk", path: "large.txt", chunkIndex: -1, totalChunks: 1, chunk: "x", isBinary: false },
  { type: "file_chunk", path: "large.txt", chunkIndex: 1, totalChunks: 1, chunk: "x", isBinary: false },
  { type: "file_chunk", path: "large.txt", chunkIndex: 0, totalChunks: 1, chunk: 123, isBinary: false },
  { type: "file_chunk", path: "large.txt", chunkIndex: 0, totalChunks: 1, chunk: "x", isBinary: "false" },
  { type: "file_chunk", path: "large.txt", chunkIndex: 0, totalChunks: 1, chunk: "x", isBinary: false, hash: "h".repeat(129) },
]) {
  assert.equal(validateFileChunk(invalidChunk).ok, false);
}

const validPreview = validateFilePreviewResponse({
  type: "file_preview_response",
  requestId: "preview-1",
  path: "src/index.ts",
  content: "preview",
  isBinary: false,
});
assert.equal(validPreview.ok, true);

const validNodeInfo = validateNodeInfo({
  type: "node_info",
  nodeName: "node-a",
  trackingDir: "/tmp/project",
  trackingFileCount: 1,
  trackingFiles: ["src/index.ts"],
  capabilities: ["has:xcode", " can:ios-build "],
});
assert.equal(validNodeInfo.ok, true);
assert.deepEqual(validNodeInfo.value.capabilities, ["has:xcode", "can:ios-build"]);

const legacyNodeInfo = validateNodeInfo({
  type: "node_info",
  nodeName: "node-b",
  trackingDir: null,
  trackingFileCount: 0,
  trackingFiles: [],
});
assert.equal(legacyNodeInfo.ok, true);
assert.deepEqual(legacyNodeInfo.value.capabilities, []);
assert.equal(validateNodeInfo({ type: "node_info", nodeName: "node-c", capabilities: ["ok", 123] }).ok, false);

assert.equal(validateFileApplied({ type: "file_applied", path: "src/index.ts", hash: "abc123" }).ok, true);
assert.equal(validateFileRejected({ type: "file_rejected", path: "src/index.ts", reason: "conflict" }).ok, true);
assert.equal(validateFilePathMessage({ type: "file_deleted", path: "src/index.ts" }, "file_deleted").ok, true);

const validCapabilityExecute = validateCapabilityExecute({
  type: "capability_execute",
  requestId: "exec-1",
  capability: "can:run-tests",
  instruction: "Run the focused test suite",
  from: "node-a",
});
assert.equal(validCapabilityExecute.ok, true);
assert.equal(validCapabilityExecute.value.requestId, "exec-1");
assert.equal(validCapabilityExecute.value.capability, "can:run-tests");

const validCapabilityExecuteWithoutRequestId = validateCapabilityExecute({
  type: "capability_execute",
  capability: "can:lint",
  instruction: "Lint the project",
  from: "node-a",
});
assert.equal(validCapabilityExecuteWithoutRequestId.ok, true);
assert.equal(validCapabilityExecuteWithoutRequestId.value.requestId, undefined);

const validCapabilityResult = validateCapabilityExecuteResult({
  type: "capability_execute_result",
  requestId: "exec-1",
  result: { ok: true },
  from: "node-b",
});
assert.equal(validCapabilityResult.ok, true);
assert.deepEqual(validCapabilityResult.value.result, { ok: true });

assert.equal(validateCapabilityExecute({ type: "capability_execute", capability: "", instruction: "x", from: "node-a" }).ok, false);
assert.equal(validateCapabilityExecute({ type: "capability_execute", capability: "can:test", instruction: "", from: "node-a" }).ok, false);
assert.equal(validateCapabilityExecuteResult({ type: "capability_execute_result", result: "ok", from: "node-b" }).ok, false);

assert.equal(parseMeshMessage(JSON.stringify({ type: "mystery" })).ok, false);
assert.equal(parseMeshMessage(JSON.stringify({ type: "capability_execute", capability: "can:test", instruction: "run", from: "node-a" })).ok, true);
assert.equal(parseMeshMessage(JSON.stringify({ type: "capability_execute_result", requestId: "exec-1", from: "node-b" })).ok, true);
assert.equal(parseMeshMessage(JSON.stringify({ type: "identity_challenge", nonce: "abc" })).ok, true);
assert.equal(parseMeshMessage(JSON.stringify({ type: "identity_proof", signature: "abc" })).ok, true);
assert.equal(parseMeshMessage("{").ok, false);
assert.equal(validateFileContent({ type: "file_content", path: "src/index.ts", content: "x", isBinary: "false" }).ok, false);
assert.equal(validateFileContent({ type: "file_content", path: "../secret.txt", content: "x", isBinary: false }).ok, false);
assert.equal(validateFileContent({ type: "file_content", path: `${"a".repeat(MAX_PATH_LENGTH + 1)}.txt`, content: "x", isBinary: false }).ok, false);

const oversizedFile = validateFileContent({
  type: "file_content",
  path: "big.txt",
  content: "x".repeat(MAX_FILE_CONTENT_BYTES + 1),
  isBinary: false,
});
assert.equal(oversizedFile.ok, false);
assert.equal(oversizedFile.reason, "payload_too_large");

const oversizedPreview = validateFilePreviewResponse({
  type: "file_preview_response",
  requestId: "preview-2",
  path: "big.txt",
  content: "x".repeat(MAX_PREVIEW_CONTENT_BYTES + 1),
  isBinary: false,
});
assert.equal(oversizedPreview.ok, false);
assert.equal(oversizedPreview.reason, "payload_too_large");

const hugeManifest = validateManifest({
  type: "manifest",
  files: Array.from({ length: MAX_MANIFEST_FILES + 5 }, (_, index) => ({
    relativePath: `file-${index}.txt`,
    hash: `hash-${index}`,
    size: index,
    isBinary: false,
  })),
});
assert.equal(hugeManifest.ok, true);
assert.equal(hugeManifest.value.files.length, MAX_MANIFEST_FILES);
assert.equal(hugeManifest.value.droppedEntries, 5);

const mixedManifest = validateManifest({
  type: "manifest",
  files: [
    { relativePath: "good.txt", hash: "ok", size: 1, isBinary: false },
    { relativePath: "../bad.txt", hash: "bad", size: 1, isBinary: false },
    { relativePath: "bad-size.txt", hash: "bad", size: -1, isBinary: false },
  ],
});
assert.equal(mixedManifest.ok, true);
assert.equal(mixedManifest.value.files.length, 1);
assert.equal(mixedManifest.value.droppedEntries, 2);

assert.equal(isRawMessageTooLarge(MAX_RAW_MESSAGE_BYTES), false);
assert.equal(isRawMessageTooLarge(MAX_RAW_MESSAGE_BYTES + 1), true);

console.log("protocol-validation tests passed");
