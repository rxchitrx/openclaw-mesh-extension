import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-relay-home-"));
process.env.HOME = tempHome;

const { createTransport } = await import("../dist/src/transport.js");
const { startMeshRelayServer } = await import("../dist/src/relay-server.js");

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function syncState(localHashes = new Map()) {
  return {
    recordRemoteChange(relativePath, hash) { localHashes.set(relativePath, hash); },
    recordSyncedHash(relativePath, hash) { localHashes.set(relativePath, hash); },
    clearPendingChanges() {},
    getPendingChanges() { return []; },
    getLocalHash(relativePath) { return localHashes.get(relativePath) ?? null; },
    isConflict() { return false; },
    consumeForceAllow() { return false; },
    getLastSentHashToPeer() { return null; },
    recordSentToPeer() {},
  };
}

function makeTransport(nodeName, port, relayUrl, state, notifications, relayPeers) {
  const transport = createTransport({
    nodeName,
    port,
    syncState: state,
    logger: logger(),
    relay: {
      url: relayUrl,
      room: "integration",
      token: "secret",
      onPeer(peer) {
        relayPeers.push(peer);
      },
    },
  });
  transport.setNotificationHandler((notification) => notifications.push(notification));
  return transport;
}

async function waitFor(predicate, label, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const relay = await startMeshRelayServer({ token: "secret", logger: logger() });
const relayUrl = `ws://127.0.0.1:${relay.port}`;
const leftHashes = new Map();
const rightHashes = new Map();
const leftNotifications = [];
const rightNotifications = [];
const leftRelayPeers = [];
const rightRelayPeers = [];
const basePort = 29000 + Math.floor(Math.random() * 1000);
const left = makeTransport("relay-left", basePort, relayUrl, syncState(leftHashes), leftNotifications, leftRelayPeers);
const right = makeTransport("relay-right", basePort + 1, relayUrl, syncState(rightHashes), rightNotifications, rightRelayPeers);
const rightDir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-relay-dest-"));

try {
  await left.start();
  await right.start();

  right.setFileWriter(async (relativePath, contentOrTempPath, isBinary, isTempFile = false) => {
    assert.equal(isBinary, false);
    const destination = path.join(rightDir, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (isTempFile) {
      await fs.copyFile(contentOrTempPath, destination);
    } else {
      await fs.writeFile(destination, contentOrTempPath, "utf-8");
    }
  });

  await waitFor(() => leftRelayPeers.some((peer) => peer.name === "relay-right"), "left sees relay-right");
  await waitFor(() => rightRelayPeers.some((peer) => peer.name === "relay-left"), "right sees relay-left");

  assert.equal(await left.connectToPeer({ name: "relay-right", host: "relay", port: 0, lastSeen: Date.now(), source: "relay" }), true);

  await waitFor(
    () => right.getPendingConnections().some((p) => p.peerName === "relay-left" && p.direction === "incoming" && p.identityVerified),
    "right pending relay identity verification",
  );
  assert.equal(right.approveConnection("relay-left"), true);
  await waitFor(() => left.getConnections().includes("relay-right"), "left connected over relay");
  await waitFor(() => right.getConnections().includes("relay-left"), "right connected over relay");

  const relativePath = "relay/hello.txt";
  const content = "hello from the relay path\n";
  leftHashes.set(relativePath, hashContent(content));
  await left.sendFileContent("relay-right", relativePath, content, false);

  const destination = path.join(rightDir, relativePath);
  await waitFor(async () => {
    try {
      return (await fs.readFile(destination, "utf-8")) === content;
    } catch {
      return false;
    }
  }, "relay file write");

  assert.equal(await fs.readFile(destination, "utf-8"), content);
  assert.equal(rightHashes.get(relativePath), hashContent(content));

  await left.stop();
  await waitFor(() => !right.getConnections().includes("relay-left"), "relay disconnect propagation");

  const leftAgain = makeTransport("relay-left", basePort + 2, relayUrl, syncState(leftHashes), leftNotifications, leftRelayPeers);
  try {
    await leftAgain.start();
    await waitFor(() => leftAgain.connectToPeer({ name: "relay-right", host: "relay", port: 0, lastSeen: Date.now(), source: "relay" }), "relay reconnect request");
    await waitFor(() => leftAgain.getConnections().includes("relay-right"), "trusted relay reconnect auto approval");
  } finally {
    await leftAgain.stop();
  }
} finally {
  await left.stop().catch(() => {});
  await right.stop().catch(() => {});
  await relay.close();
  await fs.rm(rightDir, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
}

console.log("relay-integration tests passed");
