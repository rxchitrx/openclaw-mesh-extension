import assert from "node:assert/strict";

const { default: WebSocket } = await import("ws");
const { startMeshRelayServer } = await import("../dist/src/relay-server.js");
const { MAX_RAW_MESSAGE_BYTES } = await import("../dist/src/protocol-validation.js");

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function waitFor(predicate, label, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 25);
    };
    tick();
  });
}

function connectRelay(url, registration) {
  const ws = new WebSocket(url);
  const frames = [];
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));
  return new Promise((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", ...registration }));
      resolve({ ws, frames });
    });
    ws.on("error", reject);
  });
}

const relay = await startMeshRelayServer({ token: "secret", logger: logger() });
const url = `ws://127.0.0.1:${relay.port}`;
const clients = [];

try {
  const alpha = await connectRelay(url, { room: "one", token: "secret", nodeName: "alpha", fingerprint: "AAAA", publicKey: "pub-a" });
  clients.push(alpha.ws);
  await waitFor(() => alpha.frames.some((frame) => frame.type === "registered"), "alpha registration");

  const beta = await connectRelay(url, { room: "one", token: "secret", nodeName: "beta", fingerprint: "BBBB", publicKey: "pub-b" });
  clients.push(beta.ws);
  await waitFor(() => beta.frames.some((frame) => frame.type === "registered" && frame.peers?.some((peer) => peer.name === "alpha")), "beta sees alpha");
  await waitFor(() => alpha.frames.some((frame) => frame.type === "peer_online" && frame.name === "beta"), "alpha sees beta online");

  beta.ws.send(JSON.stringify({ type: "relay_message", to: "alpha", payload: JSON.stringify({ type: "manifest_request", from: "beta" }) }));
  await waitFor(() => alpha.frames.some((frame) => frame.type === "relay_message" && frame.from === "beta"), "message forwarded");

  const gamma = await connectRelay(url, { room: "two", token: "secret", nodeName: "gamma" });
  clients.push(gamma.ws);
  await waitFor(() => gamma.frames.some((frame) => frame.type === "registered"), "gamma registration");
  assert.equal(gamma.frames.find((frame) => frame.type === "registered")?.peers?.length, 0);

  beta.ws.send(JSON.stringify({ type: "relay_message", to: "gamma", payload: "{}" }));
  await waitFor(() => beta.frames.some((frame) => frame.type === "error" && frame.code === "peer_offline"), "cross-room isolation");

  beta.ws.send(JSON.stringify({ type: "relay_message", to: "missing", payload: "{}" }));
  await waitFor(() => beta.frames.filter((frame) => frame.type === "error" && frame.code === "peer_offline").length >= 2, "offline peer error");

  beta.ws.send(JSON.stringify({ type: "relay_message", to: "alpha", payload: "x".repeat(MAX_RAW_MESSAGE_BYTES + 1) }));
  await waitFor(() => beta.frames.some((frame) => frame.type === "error" && frame.code === "payload_too_large"), "payload size limit");

  const duplicate = await connectRelay(url, { room: "one", token: "secret", nodeName: "alpha" });
  clients.push(duplicate.ws);
  await waitFor(() => alpha.frames.some((frame) => frame.type === "error" && frame.code === "duplicate_node"), "duplicate node handling");
} finally {
  for (const ws of clients) {
    try { ws.close(); } catch {}
  }
  await relay.close();
}

console.log("relay-server tests passed");
