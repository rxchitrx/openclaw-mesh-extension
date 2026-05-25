import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-capability-auto-home-"));
process.env.HOME = tempHome;

const { createTransport } = await import("../dist/src/transport.js");
const { createMeshCapabilityRespondTool } = await import("../dist/src/tools/capability-respond.js");

const basePort = 27000 + Math.floor(Math.random() * 1000);

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function syncState() {
  return {
    recordRemoteChange() {},
    recordSyncedHash() {},
    clearPendingChanges() {},
    getPendingChanges() { return []; },
    getLocalHash() { return null; },
    isConflict() { return false; },
    consumeForceAllow() { return false; },
    getLastSentHashToPeer() { return null; },
    recordSentToPeer() {},
  };
}

function makeTransport(nodeName, port, notifications) {
  const transport = createTransport({
    nodeName,
    port,
    syncState: syncState(),
    logger: logger(),
    executionTimeoutMs: 2000,
  });
  transport.setNotificationHandler((notification) => notifications.push(notification));
  transport.setNodeInfoProvider(() => ({
    nodeName,
    trackingDir: null,
    trackingFileCount: 0,
    trackingFiles: [],
    capabilities: [],
  }));
  transport.setManifestProvider(() => []);
  return transport;
}

async function waitFor(predicate, label, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const leftNotifications = [];
const rightNotifications = [];
const left = makeTransport("auto-left", basePort, leftNotifications);
const right = makeTransport("auto-right", basePort + 1, rightNotifications);

try {
  await left.start();
  await right.start();

  assert.equal(await left.connectToPeer({ name: "auto-right", host: "127.0.0.1", port: basePort + 1, lastSeen: Date.now(), source: "transport" }), true);
  await waitFor(
    () => right.getPendingConnections().some((p) => p.peerName === "auto-left" && p.direction === "incoming" && p.identityVerified),
    "right pending identity verification",
  );
  assert.equal(right.approveConnection("auto-left"), true);
  await waitFor(() => left.getConnections().includes("auto-right"), "left connected");
  await waitFor(() => right.getConnections().includes("auto-left"), "right connected");

  right.setNodeInfoProvider(() => ({
    nodeName: "auto-right",
    trackingDir: null,
    trackingFileCount: 0,
    trackingFiles: [],
    capabilities: ["can:auto"],
  }));
  right.broadcastNodeInfo();

  await waitFor(
    () => left.getPendingExecutions("auto-right").some((execution) => execution.direction === "outgoing" && execution.capability === "can:auto"),
    "left outgoing auto request",
  );
  await waitFor(
    () => right.getPendingExecutions("auto-left").some((execution) => execution.direction === "incoming" && execution.capability === "can:auto"),
    "right incoming auto request",
  );
  const initialIncomingCount = right.getPendingExecutions("auto-left").filter((execution) => execution.capability === "can:auto").length;
  right.broadcastNodeInfo();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(right.getPendingExecutions("auto-left").filter((execution) => execution.capability === "can:auto").length, initialIncomingCount);

  const responseTool = createMeshCapabilityRespondTool(right, {});
  const response = await responseTool.execute("auto-respond", { result: "auto handled" }, undefined, undefined);
  assert.equal(response.details.ok, true);
  assert.equal(response.details.autoSelectedRequestId, true);
  await waitFor(
    () => leftNotifications.some((event) => event.type === "capability_execute_completed" && event.data?.result === "auto handled"),
    "left auto completion",
  );
} finally {
  await left.stop();
  await right.stop();
  await fs.rm(tempHome, { recursive: true, force: true });
}

console.log("capability-auto-request tests passed");
