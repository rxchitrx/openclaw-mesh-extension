import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-persistence-home-"));
process.env.HOME = tempHome;

const { createSyncState } = await import("../dist/src/sync-state.js");
const { createMeshEventStore } = await import("../dist/src/events.js");

const logger = {
  info() {},
  warn(message) {
    throw new Error(message);
  },
};

try {
  const meshDir = path.join(tempHome, ".openclaw", "mesh");

  const firstSyncState = createSyncState({ nodeName: "node-a", logger });
  assert.deepEqual(firstSyncState.getFiles(), []);
  assert.deepEqual(firstSyncState.getPendingChanges(), []);
  assert.equal(firstSyncState.getLastSyncedHash("missing.txt"), null);

  firstSyncState.recordLocalChange("notes/local.txt", "hash-local-1", false);
  firstSyncState.recordRemoteChange("notes/remote.bin", "hash-remote-1", "node-b", true);
  firstSyncState.recordSyncedHash("notes/local.txt", "hash-local-0");

  const reloadedSyncState = createSyncState({ nodeName: "node-a", logger });
  assert.equal(reloadedSyncState.getLocalHash("notes/local.txt"), "hash-local-1");
  assert.equal(reloadedSyncState.getLocalHash("notes/remote.bin"), "hash-remote-1");
  assert.equal(reloadedSyncState.getLastSyncedHash("notes/local.txt"), "hash-local-0");
  assert.equal(reloadedSyncState.getLastSyncedHash("notes/remote.bin"), "hash-remote-1");
  assert.equal(reloadedSyncState.isLocallyModified("notes/local.txt"), true);
  assert.deepEqual(reloadedSyncState.getPendingChanges().map((change) => change.relativePath), ["notes/local.txt"]);

  reloadedSyncState.clearPendingChanges(["notes/local.txt"]);
  const clearedSyncState = createSyncState({ nodeName: "node-a", logger });
  assert.deepEqual(clearedSyncState.getPendingChanges(), []);

  const firstEventStore = createMeshEventStore({ logger });
  assert.equal(firstEventStore.listRecent().length, 0);
  const firstEvent = firstEventStore.addEvent({
    kind: "file_written",
    message: "Wrote notes/local.txt",
    peerName: "node-b",
    filePath: "notes/local.txt",
    details: { bytes: 42 },
  });
  firstEventStore.markDelivered([firstEvent.id], 1234);
  assert.deepEqual(firstEventStore.acknowledge(firstEvent.id), { acknowledged: 1, all: false });

  const reloadedEventStore = createMeshEventStore({ logger });
  const reloadedEvents = reloadedEventStore.listRecent();
  assert.equal(reloadedEvents.length, 1);
  assert.equal(reloadedEvents[0].id, firstEvent.id);
  assert.equal(reloadedEvents[0].delivered, true);
  assert.equal(reloadedEvents[0].acknowledged, true);
  assert.equal(reloadedEvents[0].lastDeliveredAt, 1234);
  assert.equal(reloadedEvents[0].details.bytes, 42);

  const manyEvents = Array.from({ length: 205 }, (_, index) => ({
    id: `event-${index}`,
    kind: "sync_applied",
    createdAt: index,
    message: `event ${index}`,
    delivered: false,
    acknowledged: false,
    occurrences: 1,
  }));
  await fs.writeFile(path.join(meshDir, "events.json"), JSON.stringify(manyEvents, null, 2), { mode: 0o600 });

  const cappedEventStore = createMeshEventStore({ logger });
  const cappedEvents = cappedEventStore.listRecent(250);
  assert.equal(cappedEvents.length, 200);
  assert.equal(cappedEvents.at(-1).id, "event-5");
  assert.equal(cappedEvents[0].id, "event-204");

  const persistedSync = JSON.parse(await fs.readFile(path.join(meshDir, "sync-state.json"), "utf-8"));
  assert.equal(persistedSync.fileVersions.length, 2);
  assert.ok(Array.isArray(persistedSync.lastSyncedHashes));
  assert.ok(Array.isArray(persistedSync.pendingChanges));
} finally {
  await fs.rm(tempHome, { recursive: true, force: true });
}

console.log("persistence tests passed");
