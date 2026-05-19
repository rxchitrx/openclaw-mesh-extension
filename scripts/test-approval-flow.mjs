import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-approval-home-"));
process.env.HOME = tempHome;

const { createTransport } = await import("../dist/src/transport.js");
const { loadOrCreateIdentity, trustPeer } = await import("../dist/src/peer-identity.js");

const basePort = 23000 + Math.floor(Math.random() * 1000);

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
    recordFileReceived() {},
    clearPendingChange() {},
    getPendingChanges() { return []; },
  };
}

function makeTransport(nodeName, port, notifications) {
  const transport = createTransport({
    nodeName,
    port,
    syncState: syncState(),
    logger: logger(),
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

async function withPair(leftName, rightName, leftPort, rightPort, run) {
  const leftNotifications = [];
  const rightNotifications = [];
  const left = makeTransport(leftName, leftPort, leftNotifications);
  const right = makeTransport(rightName, rightPort, rightNotifications);
  await left.start();
  await right.start();
  try {
    await run(left, right, leftNotifications, rightNotifications);
  } finally {
    await left.stop();
    await right.stop();
  }
}

try {
  await withPair("node-a", "node-b", basePort, basePort + 1, async (left, right, leftNotifications, rightNotifications) => {
    assert.equal(await left.connectToPeer({ name: "node-b", host: "127.0.0.1", port: basePort + 1, lastSeen: Date.now(), source: "transport" }), true);

    await waitFor(
      () => left.getPendingConnections().some((p) => p.peerName === "node-b" && p.direction === "outgoing" && p.identityVerified),
      "outgoing pending identity verification",
    );
    await waitFor(
      () => right.getPendingConnections().some((p) => p.peerName === "node-a" && p.direction === "incoming" && p.identityVerified),
      "incoming pending identity verification",
    );

    assert.equal(left.approveConnection("node-b"), false);
    assert.equal(left.getConnections().includes("node-b"), false);

    assert.equal(right.approveConnection("node-a"), true);
    await waitFor(() => left.getConnections().includes("node-b"), "outgoing side approval response");
    await waitFor(() => right.getConnections().includes("node-a"), "incoming side approved connection");
    await waitFor(
      () => leftNotifications.some((event) => event.type === "peer_approved" && event.data?.direction === "inbound"),
      "outgoing approval notification direction",
    );
    await waitFor(
      () => rightNotifications.some((event) => event.type === "peer_approved" && event.data?.direction === "outbound"),
      "incoming approval notification direction",
    );
  });

  await withPair("node-c", "node-d", basePort + 2, basePort + 3, async (left, right, leftNotifications, rightNotifications) => {
    assert.equal(await left.connectToPeer({ name: "node-d", host: "127.0.0.1", port: basePort + 3, lastSeen: Date.now(), source: "transport" }), true);

    await waitFor(
      () => right.getPendingConnections().some((p) => p.peerName === "node-c" && p.direction === "incoming" && p.identityVerified),
      "incoming pending before deny",
    );
    assert.equal(left.denyConnection("node-d"), false);
    assert.equal(right.denyConnection("node-c"), true);

    await waitFor(() => left.getPendingConnections().length === 0, "outgoing pending removal after deny");
    assert.equal(left.getConnections().includes("node-d"), false);
    assert.equal(right.getConnections().includes("node-c"), false);
    await waitFor(
      () => leftNotifications.some((event) => event.type === "peer_denied" && event.data?.direction === "inbound"),
      "outgoing denial notification direction",
    );
    await waitFor(
      () => rightNotifications.some((event) => event.type === "peer_denied" && event.data?.direction === "outbound"),
      "incoming denial notification direction",
    );
  });

  await withPair("node-e", "node-f", basePort + 4, basePort + 5, async (left, right, leftNotifications, rightNotifications) => {
    const identity = loadOrCreateIdentity();
    trustPeer("node-f", identity.fingerprint, identity.publicKey);

    assert.equal(await right.connectToPeer({ name: "node-e", host: "127.0.0.1", port: basePort + 4, lastSeen: Date.now(), source: "transport" }), true);

    await waitFor(() => left.getConnections().includes("node-f"), "trusted inbound auto approval");
    await waitFor(() => right.getConnections().includes("node-e"), "trusted outbound approval response");
    await waitFor(
      () => leftNotifications.some((event) => event.type === "peer_approved" && event.data?.direction === "outbound"),
      "trusted auto-approval notification direction",
    );
    await waitFor(
      () => rightNotifications.some((event) => event.type === "peer_approved" && event.data?.direction === "inbound"),
      "trusted requester approval notification direction",
    );
  });
} finally {
  await fs.rm(tempHome, { recursive: true, force: true });
}

console.log("approval-flow tests passed");
