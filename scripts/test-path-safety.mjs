import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeRelativePath, resolveInsideRoot } from "../dist/src/path-safety.js";

const accepted = [
  ["src/index.ts", "src/index.ts"],
  ["folder/file.txt", "folder/file.txt"],
  ["a-b_c/file.json", "a-b_c/file.json"],
  ["folder\\nested\\file.txt", "folder/nested/file.txt"],
  ["folder/./file.txt", "folder/file.txt"],
];

for (const [input, expected] of accepted) {
  assert.equal(normalizeRelativePath(input), expected, `${input} should normalize safely`);
}

const rejected = [
  "../secret.txt",
  "src/../../secret.txt",
  "/tmp/secret.txt",
  "C:\\Users\\secret.txt",
  "\\\\server\\share",
  "",
  "   ",
  "bad\0name.txt",
  ".",
];

for (const input of rejected) {
  assert.equal(normalizeRelativePath(input), null, `${JSON.stringify(input)} should be rejected`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-path-safety-"));
try {
  const valid = resolveInsideRoot(root, "src/new-file.ts");
  assert.equal(valid, path.join(root, "src", "new-file.ts"));

  const escaped = resolveInsideRoot(root, "../../outside.txt");
  assert.equal(escaped, null);

  const outsidePath = path.join(path.dirname(root), `mesh-path-safety-outside-${Date.now()}.txt`);
  assert.equal(resolveInsideRoot(root, `../${path.basename(outsidePath)}`), null);
  await assert.rejects(fs.stat(outsidePath));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log("path-safety tests passed");
