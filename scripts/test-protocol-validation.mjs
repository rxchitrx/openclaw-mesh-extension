import assert from "node:assert/strict";

import {
  MAX_FILE_CONTENT_BYTES,
  MAX_MANIFEST_FILES,
  MAX_PATH_LENGTH,
  MAX_PREVIEW_CONTENT_BYTES,
  MAX_RAW_MESSAGE_BYTES,
  isRawMessageTooLarge,
  parseMeshMessage,
  validateFileApplied,
  validateFileContent,
  validateFilePathMessage,
  validateFilePreviewResponse,
  validateFileRejected,
  validateManifest,
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

const validPreview = validateFilePreviewResponse({
  type: "file_preview_response",
  requestId: "preview-1",
  path: "src/index.ts",
  content: "preview",
  isBinary: false,
});
assert.equal(validPreview.ok, true);

assert.equal(validateFileApplied({ type: "file_applied", path: "src/index.ts", hash: "abc123" }).ok, true);
assert.equal(validateFileRejected({ type: "file_rejected", path: "src/index.ts", reason: "conflict" }).ok, true);
assert.equal(validateFilePathMessage({ type: "file_deleted", path: "src/index.ts" }, "file_deleted").ok, true);

assert.equal(parseMeshMessage(JSON.stringify({ type: "mystery" })).ok, false);
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
