import assert from "node:assert/strict";
import fs from "node:fs";

import { createMeshBroadcastTool } from "../dist/src/tools/broadcast.js";
import { createMeshDiffTool } from "../dist/src/tools/diff.js";
import { createMeshStatusTool } from "../dist/src/tools/status.js";
import { createMeshSyncTool } from "../dist/src/tools/sync.js";

function syncState(pending = []) {
  return {
    pending,
    getPendingChanges() { return [...this.pending]; },
    clearPendingChanges(paths) {
      if (!paths) {
        this.pending.length = 0;
        return;
      }
      const set = new Set(paths);
      this.pending = this.pending.filter((change) => !set.has(change.relativePath));
    },
    isLocallyModified() { return false; },
    markForceAllow() {},
  };
}

const trackState = { currentTrackDir: null };
const getTrackState = () => trackState;
const state = syncState([{ relativePath: "stale.txt", hash: "abc", isBinary: false, timestamp: Date.now() }]);
const transport = {
  getConnections() { return ["node-b"]; },
  getPendingConnections() { return []; },
  getRemoteManifest() { return []; },
  getInFlightSends() { return []; },
  getPendingExecutions() { return []; },
  getRemoteAppliedFiles() { return []; },
  getRemoteRejectedFiles() { return []; },
  getNodeInfo() { return { capabilities: ["can:test"], trackingDir: "/tmp/remote", trackingFileCount: 1, trackingFiles: [] }; },
  getPeerFingerprint() { return null; },
  getPeerTrustWarning() { return null; },
};

const syncTool = createMeshSyncTool({
  syncState: state,
  transport,
  getFileContent: async () => null,
  getLocalManifest: () => [],
  getTrackState,
}, {});
const syncResult = await syncTool.execute("sync-no-track", { action: "manifest", peerName: "node-b" }, undefined, undefined);
assert.equal(syncResult.details.ok, false);
assert.equal(syncResult.details.error, "no_tracked_directory");
assert.equal(syncResult.details.clearedStalePendingChanges, 1);
assert.equal(state.getPendingChanges().length, 0);

const broadcastTool = createMeshBroadcastTool({
  syncState: state,
  transport,
  getFileContent: async () => null,
  getLocalManifest: () => [],
  getTrackState,
}, {});
const broadcastResult = await broadcastTool.execute("broadcast-no-track", {}, undefined, undefined);
assert.equal(broadcastResult.details.error, "no_tracked_directory");

const diffTool = createMeshDiffTool({
  syncState: state,
  transport: { ...transport, requestFilePreview: async () => null },
  getFileContent: async () => null,
  getLocalManifest: () => [],
  getTrackState,
}, {});
const diffResult = await diffTool.execute("diff-no-track", { peerName: "node-b" }, undefined, undefined);
assert.equal(diffResult.details.error, "no_tracked_directory");

const statusTool = createMeshStatusTool({
  discovery: {
    getLocalNode() {
      return {
        name: "node-a",
        host: "192.168.1.10",
        port: 18790,
        primaryAddress: "192.168.1.10",
        addresses: ["192.168.1.10", "10.0.0.5"],
      };
    },
    getPeers() { return []; },
  },
  transport,
  syncState: state,
  getTrackState: () => ({ currentTrackDir: null, fileWatcher: null }),
  capabilityRegistry: { list: () => ["has:node"] },
}, {});
const status = await statusTool.execute("status", {}, undefined, undefined);
assert.match(status.content[0].text, /Primary LAN IP: 192\.168\.1\.10/);
assert.match(status.content[0].text, /Other local IPv4s: 10\.0\.0\.5/);
assert.match(status.content[0].text, /WARNING: no tracked directory/);

const indexSource = fs.readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
const heartbeatBody = indexSource.slice(indexSource.indexOf('api.on("heartbeat_prompt_contribution"'));
assert.equal(/await discovery\.scan\(\)/.test(heartbeatBody), false);
assert.equal(/await transport\.connectToPeer/.test(heartbeatBody), false);

console.log("mesh-stability-tools tests passed");
