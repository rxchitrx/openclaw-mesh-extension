import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-capability-execution-home-"));
process.env.HOME = tempHome;

const { createTransport } = await import("../dist/src/transport.js");

const basePort = 25000 + Math.floor(Math.random() * 1000);

function logger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
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
  };
}

function makeTransport(nodeName, port, notifications, executionTimeoutMs = 1000) {
  const transport = createTransport({
    nodeName,
    port,
    syncState: syncState(),
    logger: logger(),
    executionTimeoutMs,
  });
  transport.setNotificationHandler((notification) => {
    notifications.push(notification);
  });
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
const thirdNotifications = [];
const left = makeTransport("node-a", basePort, leftNotifications);
const right = makeTransport("node-b", basePort + 1, rightNotifications, 500);
const third = makeTransport("node-c", basePort + 2, thirdNotifications);

try {
  await left.start();
  await right.start();
  await third.start();

  assert.equal(await left.connectToPeer({ name: "node-b", host: "127.0.0.1", port: basePort + 1, lastSeen: Date.now(), source: "transport" }), true);
  await waitFor(
    () => right.getPendingConnections().some((p) => p.peerName === "node-a" && p.direction === "incoming" && p.identityVerified),
    "incoming pending identity verification",
  );
  assert.equal(right.approveConnection("node-a"), true);
  await waitFor(() => left.getConnections().includes("node-b"), "left connected");
  await waitFor(() => right.getConnections().includes("node-a"), "right connected");

  assert.equal(await third.connectToPeer({ name: "node-b", host: "127.0.0.1", port: basePort + 1, lastSeen: Date.now(), source: "transport" }), true);
  await waitFor(
    () => right.getPendingConnections().some((p) => p.peerName === "node-c" && p.direction === "incoming" && p.identityVerified),
    "third incoming pending identity verification",
  );
  assert.equal(right.approveConnection("node-c"), true);
  await waitFor(() => third.getConnections().includes("node-b"), "third connected");
  await waitFor(() => right.getConnections().includes("node-c"), "right connected to third");

  left.sendToPeer("node-b", {
    type: "capability_execute",
    requestId: "exec-test-1",
    capability: "can:run-tests",
    instruction: "Run npm test",
    from: "node-a",
  });

  await waitFor(
    () => right.getPendingExecutions().some((execution) => execution.requestId === "exec-test-1"),
    "pending execution with preserved requestId",
  );
  const pending = right.getPendingExecutions("node-a");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestId, "exec-test-1");
  assert.equal(pending[0].capability, "can:run-tests");
  assert.equal(pending[0].instruction, "Run npm test");
  assert.equal(pending[0].from, "node-a");

  await waitFor(
    () => rightNotifications.some((event) => event.type === "capability_execute_requested" && event.data?.requestId === "exec-test-1"),
    "capability execution request notification",
  );

  third.sendToPeer("node-b", {
    type: "capability_execute_result",
    requestId: "exec-test-1",
    result: "spoofed",
    from: "node-c",
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(right.getPendingExecutions().some((execution) => execution.requestId === "exec-test-1"), true);

  left.sendToPeer("node-b", {
    type: "capability_execute",
    capability: "can:lint",
    instruction: "Lint the project",
    from: "node-a",
  });
  await waitFor(
    () => right.getPendingExecutions().some((execution) => execution.capability === "can:lint" && execution.requestId.startsWith("exec-")),
    "generated requestId for capability execution",
  );

  await waitFor(
    () => rightNotifications.some((event) => event.type === "capability_execute_completed" && event.data?.requestId === "exec-test-1" && event.data?.error === "timeout"),
    "timeout completion notification",
  );
  assert.equal(right.getPendingExecutions().some((execution) => execution.requestId === "exec-test-1"), false);
} finally {
  await left.stop();
  await right.stop();
  await third.stop();
  await fs.rm(tempHome, { recursive: true, force: true });
}

console.log("capability-execution tests passed");
