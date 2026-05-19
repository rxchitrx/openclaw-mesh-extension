import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileWatcher } from "../dist/src/file-watcher.js";

function createSyncState() {
  return {
    recordLocalChange() {},
    recordSyncedHash() {},
    removeFile() {},
    markAllSynced() {},
  };
}

function createLogger() {
  return {
    debug() {},
    error(message) {
      throw new Error(String(message));
    },
    info() {},
    warn() {},
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-ignore-root-"));

try {
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "coverage"), { recursive: true });

  await fs.writeFile(path.join(root, "node_modules", "pkg", "ignored.js"), "module", "utf-8");
  await fs.writeFile(path.join(root, "dist", "ignored.js"), "dist", "utf-8");
  await fs.writeFile(path.join(root, ".DS_Store"), "metadata", "utf-8");
  await fs.writeFile(path.join(root, "coverage", "ignored.json"), "coverage", "utf-8");
  await fs.writeFile(path.join(root, "src", "tracked.ts"), "tracked", "utf-8");

  const watcher = createFileWatcher({
    workspaceDir: root,
    syncState: createSyncState(),
    logger: createLogger(),
    ignorePatterns: ["(^|/)coverage(/|$)", "\\.generated\\.ts$"],
  });

  await watcher.syncAllFiles();

  assert.deepEqual(watcher.getWatchedFiles().sort(), ["src/tracked.ts"]);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log("ignore-pattern tests passed");
