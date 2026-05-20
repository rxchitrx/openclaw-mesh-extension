import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { createPatchPayload } from "../dist/src/diff-engine.js";
import { applyUnifiedPatch } from "../dist/src/patch-apply.js";

function computeHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

{
  // Test: Patch generation, application, and hash verification
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
  // Test: Gzip compression/decompression compatibility
  const oldText = "A".repeat(1000);
  const newText = "A".repeat(500) + "B".repeat(500);
  
  const payload = createPatchPayload("test.txt", oldText, newText, computeHash(oldText), computeHash(newText), 3);
  
  // Compress
  const compressedBuffer = zlib.gzipSync(payload.patch);
  const encoded = compressedBuffer.toString("base64");
  
  // Size verification (should be smaller for large repetitive text patches)
  assert.ok(encoded.length < payload.patch.length);
  
  // Decompress
  const decodedBuffer = Buffer.from(encoded, "base64");
  const decompressedPatch = zlib.gunzipSync(decodedBuffer).toString("utf-8");
  
  assert.equal(decompressedPatch, payload.patch);
  
  // Verify application works with decompressed patch
  const reconstructed = applyUnifiedPatch(oldText, decompressedPatch);
  assert.equal(reconstructed, newText);
}

{
  // Test: Corrupted patch rejection (failure handling)
  const oldText = "line 1\nline 2\n";
  const newText = "line 1\nline 2\nline 3\n";
  const payload = createPatchPayload("test.txt", oldText, newText, computeHash(oldText), computeHash(newText), 3);
  
  const corruptedPatch = payload.patch.replace("@@", "XX");
  
  assert.throws(() => {
    applyUnifiedPatch(oldText, corruptedPatch);
  }, /Malformed patch/);
  
  const mismatchedContextPatch = payload.patch.replace(" line 2", " line X");
  assert.throws(() => {
    applyUnifiedPatch(oldText, mismatchedContextPatch);
  }, /Patch verification failed/);
}

{
  // Test: Uncompressed compatibility (edge cases)
  const oldText = "hello";
  const newText = "world";
  
  const payload = createPatchPayload("test.txt", oldText, newText, computeHash(oldText), computeHash(newText), 3);
  const reconstructed = applyUnifiedPatch(oldText, payload.patch);
  assert.equal(reconstructed, newText);
}

console.log("patch-sync tests passed");
