import assert from "node:assert/strict";
import { createDiffPreview } from "../dist/src/diff-engine.js";

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

console.log("diff-engine tests passed");
