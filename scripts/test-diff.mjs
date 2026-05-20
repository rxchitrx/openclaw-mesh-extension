import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { createDiffPreview, createPatchPayload } from "../dist/src/diff-engine.js";
import { applyUnifiedPatch } from "../dist/src/patch-apply.js";

function computeHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const textFile = (relativePath, content, hash = "hash") => ({
  relativePath,
  isBinary: false,
  hash,
  size: Buffer.byteLength(content, "utf-8"),
});

const binaryFile = (relativePath, size, hash = "hash") => ({
  relativePath,
  isBinary: true,
  hash,
  size,
});

{
  const preview = createDiffPreview({
    path: "new.txt",
    local: { file: textFile("new.txt", "hello\nworld", "local"), content: "hello\nworld" },
    contextLines: 3,
  });
  assert.equal(preview.kind, "added");
  assert.match(preview.patch, /\+hello/);
  assert.match(preview.patch, /\+world/);
}

{
  const preview = createDiffPreview({
    path: "old.txt",
    remote: { file: textFile("old.txt", "bye\nworld", "remote"), content: "bye\nworld" },
    contextLines: 3,
  });
  assert.equal(preview.kind, "deleted");
  assert.match(preview.patch, /-bye/);
  assert.match(preview.patch, /-world/);
}

{
  const preview = createDiffPreview({
    path: "app.ts",
    local: { file: textFile("app.ts", "one\ntwo changed\nthree", "local"), content: "one\ntwo changed\nthree" },
    remote: { file: textFile("app.ts", "one\ntwo\nthree", "remote"), content: "one\ntwo\nthree" },
    contextLines: 1,
  });
  assert.equal(preview.kind, "modified");
  assert.match(preview.patch, /-two/);
  assert.match(preview.patch, /\+two changed/);
}

{
  const preview = createDiffPreview({
    path: "image.png",
    local: { file: binaryFile("image.png", 20, "local") },
    remote: { file: binaryFile("image.png", 10, "remote") },
  });
  assert.equal(preview.kind, "binary");
  assert.equal(preview.patch, undefined);
  assert.match(preview.summary, /Binary file differs/);
}

{
  const large = "x".repeat(3000);
  const preview = createDiffPreview({
    path: "large.md",
    local: { file: textFile("large.md", large, "local"), content: large },
    remote: { file: textFile("large.md", "small", "remote"), content: "small" },
    maxBytes: 1024,
  });
  assert.equal(preview.kind, "large");
  assert.equal(preview.patch, undefined);
}

{
  // Patch generation, application, and hash verification
  const oldText = "line 1\nline 2\nline 3\n";
  const newText = "line 1\nline 2 updated\nline 3\nline 4 added\n";
  const parentHash = computeHash(oldText);
  const targetHash = computeHash(newText);
  const payload = createPatchPayload("test.txt", oldText, newText, parentHash, targetHash, 3);
  assert.equal(payload.parentHash, parentHash);
  assert.equal(payload.targetHash, targetHash);
  assert.ok(payload.patch.length > 0);
  const reconstructed = applyUnifiedPatch(oldText, payload.patch);
  assert.equal(reconstructed, newText);
  const reconstructedHash = computeHash(reconstructed);
  assert.equal(reconstructedHash, targetHash);
}

{
  // Gzip compression/decompression compatibility
  const oldText = "A".repeat(1000);
  const newText = "A".repeat(500) + "B".repeat(500);
  const payload = createPatchPayload("test.txt", oldText, newText, computeHash(oldText), computeHash(newText), 3);
  const compressedBuffer = zlib.gzipSync(payload.patch);
  const encoded = compressedBuffer.toString("base64");
  assert.ok(encoded.length < payload.patch.length);
  const decodedBuffer = Buffer.from(encoded, "base64");
  const decompressedPatch = zlib.gunzipSync(decodedBuffer).toString("utf-8");
  assert.equal(decompressedPatch, payload.patch);
  const reconstructed = applyUnifiedPatch(oldText, decompressedPatch);
  assert.equal(reconstructed, newText);
}

{
  // Corrupted patch rejection
  const oldText = "line 1\nline 2\n";
  const newText = "line 1\nline 2\nline 3\n";
  const payload = createPatchPayload("test.txt", oldText, newText, computeHash(oldText), computeHash(newText), 3);
  const corruptedPatch = payload.patch.replace("@@", "XX");
  assert.throws(() => { applyUnifiedPatch(oldText, corruptedPatch); }, /Malformed patch/);
  const mismatchedContextPatch = payload.patch.replace(" line 2", " line X");
  assert.throws(() => { applyUnifiedPatch(oldText, mismatchedContextPatch); }, /Patch verification failed/);
}

{
  // Complete replacement
  const oldText = "hello";
  const newText = "world";
  const payload = createPatchPayload("test.txt", oldText, newText, computeHash(oldText), computeHash(newText), 3);
  const reconstructed = applyUnifiedPatch(oldText, payload.patch);
  assert.equal(reconstructed, newText);
}

{
  // No-change patch
  const text = "same\ncontent\n";
  const hash = computeHash(text);
  const payload = createPatchPayload("test.txt", text, text, hash, hash, 3);
  const reconstructed = applyUnifiedPatch(text, payload.patch);
  assert.equal(reconstructed, text);
}

console.log("diff-engine tests passed");
