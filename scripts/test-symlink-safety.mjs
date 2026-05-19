import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileWatcher } from "../dist/src/file-watcher.js";

function createSyncState() {
  const localChanges = [];
  return {
    localChanges,
    recordLocalChange(relativePath, hash, isBinary) {
      localChanges.push({ relativePath, hash, isBinary });
    },
    recordSyncedHash() {},
    removeFile() {},
    markAllSynced() {},
  };
}

function createLogger() {
  const warnings = [];
  return {
    warnings,
    debug() {},
    error(message) {
      throw new Error(String(message));
    },
    info() {},
    warn(message) {
      warnings.push(String(message));
    },
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-symlink-root-"));
const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-symlink-outside-"));

try {
  await fs.mkdir(path.join(root, "internal"), { recursive: true });
  await fs.writeFile(path.join(root, "internal", "safe.txt"), "inside", "utf-8");
  await fs.writeFile(path.join(outsideDir, "secret.txt"), "outside", "utf-8");

  await fs.symlink(path.join(root, "internal", "safe.txt"), path.join(root, "safe-link.txt"));
  await fs.symlink(path.join(outsideDir, "secret.txt"), path.join(root, "escape-link.txt"));

  const syncState = createSyncState();
  const logger = createLogger();
  const watcher = createFileWatcher({ workspaceDir: root, syncState, logger });

  await watcher.syncAllFiles();

  const watched = watcher.getWatchedFiles().sort();
  assert.deepEqual(watched, ["internal/safe.txt", "safe-link.txt"]);
  assert.equal(syncState.localChanges.some((change) => change.relativePath === "escape-link.txt"), false);
  assert.equal(logger.warnings.some((message) => message.includes("escape-link.txt") && message.includes("outside tracked workspace")), true);

  const safeLinkContent = await watcher.getFileContent("safe-link.txt");
  assert.equal(safeLinkContent?.content, "inside");
} finally {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
}

console.log("symlink-safety tests passed");
