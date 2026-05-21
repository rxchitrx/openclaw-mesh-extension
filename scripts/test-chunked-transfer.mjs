import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-chunked-transfer-home-"));
process.env.HOME = tempHome;

const { createTransport } = await import("../dist/src/transport.js");
const { MAX_FILE_CONTENT_BYTES } = await import("../dist/src/protocol-validation.js");

const basePort = 26000 + Math.floor(Math.random() * 1000);

function logger() {
  return {
    debug() {},
    info() {},
    warn(message) { console.warn(message); },
    error(message) { console.error(message); },
  };
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function syncState(localHashes = new Map()) {
  return {
    recordRemoteChange(relativePath, hash) {
      localHashes.set(relativePath, hash);
    },
    recordSyncedHash(relativePath, hash) {
      localHashes.set(relativePath, hash);
    },
    clearPendingChanges() {},
    getPendingChanges() { return []; },
    getLocalHash(relativePath) { return localHashes.get(relativePath) ?? null; },
    isConflict() { return false; },
    consumeForceAllow() { return false; },
    getLastSentHashToPeer() { return null; },
    recordSentToPeer() {},
  };
}

function makeTransport(nodeName, port, state, notifications) {
  const transport = createTransport({
    nodeName,
    port,
    syncState: state,
    logger: logger(),
  });
  transport.setNotificationHandler((notification) => {
    notifications.push(notification);
  });
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

const senderHashes = new Map();
const receiverHashes = new Map();
const senderNotifications = [];
const receiverNotifications = [];
const sender = makeTransport("chunk-sender", basePort, syncState(senderHashes), senderNotifications);
const receiver = makeTransport("chunk-receiver", basePort + 1, syncState(receiverHashes), receiverNotifications);
const receiverDir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-chunked-transfer-dest-"));

try {
  await sender.start();
  await receiver.start();

  receiver.setFileWriter(async (relativePath, contentOrTempPath, isBinary, isTempFile = false) => {
    assert.equal(isBinary, false);
    const destination = path.join(receiverDir, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (isTempFile) {
      await fs.copyFile(contentOrTempPath, destination);
    } else {
      await fs.writeFile(destination, contentOrTempPath, "utf-8");
    }
  });

  assert.equal(await sender.connectToPeer({
    name: "chunk-receiver",
    host: "127.0.0.1",
    port: basePort + 1,
    lastSeen: Date.now(),
    source: "transport",
  }), true);

  await waitFor(
    () => receiver.getPendingConnections().some((p) => p.peerName === "chunk-sender" && p.direction === "incoming" && p.identityVerified),
    "receiver pending identity verification",
  );
  assert.equal(receiver.approveConnection("chunk-sender"), true);
  await waitFor(() => sender.getConnections().includes("chunk-receiver"), "sender connected");
  await waitFor(() => receiver.getConnections().includes("chunk-sender"), "receiver connected");

  const relativePath = "large/chunked.txt";
  const content = "0123456789abcdef\n".repeat(Math.ceil((MAX_FILE_CONTENT_BYTES + 12345) / 17));
  assert.ok(Buffer.byteLength(content, "utf-8") > MAX_FILE_CONTENT_BYTES);
  senderHashes.set(relativePath, hashContent(content));

  await sender.sendFileContent("chunk-receiver", relativePath, content, false);

  const destination = path.join(receiverDir, relativePath);
  await waitFor(async () => {
    try {
      return (await fs.readFile(destination, "utf-8")) === content;
    } catch {
      return false;
    }
  }, "chunked file write");

  assert.equal(await fs.readFile(destination, "utf-8"), content);
  assert.equal(receiverHashes.get(relativePath), hashContent(content));
  assert.equal(receiverNotifications.some((event) => event.type === "file_received" && event.filePath === relativePath), true);
} finally {
  await sender.stop();
  await receiver.stop();
  await fs.rm(receiverDir, { recursive: true, force: true });
  await fs.rm(tempHome, { recursive: true, force: true });
}

console.log("chunked-transfer tests passed");
