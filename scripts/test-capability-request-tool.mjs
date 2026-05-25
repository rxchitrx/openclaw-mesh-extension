import assert from "node:assert/strict";

import { createMeshCapabilityRequestTool } from "../dist/src/tools/capability-request.js";

const sent = [];
const transport = {
  connections: ["node-b"],
  nextRequestId: "generated-id",
  failSend: false,
  getConnections() {
    return this.connections;
  },
  sendCapabilityExecute(peerName, capability, instruction, requestId) {
    if (this.failSend) return null;
    const finalRequestId = requestId || this.nextRequestId;
    sent.push({ peerName, capability, instruction, requestId, finalRequestId });
    return finalRequestId;
  },
};

const tool = createMeshCapabilityRequestTool(transport, {});

const missingPeer = await tool.execute("call-missing-peer", {
  capability: "can:test",
  instruction: "Run tests",
}, undefined, undefined);
assert.equal(missingPeer.details.ok, false);
assert.equal(missingPeer.details.error, "missing_peer_name");

const missingCapability = await tool.execute("call-missing-capability", {
  peerName: "node-b",
  instruction: "Run tests",
}, undefined, undefined);
assert.equal(missingCapability.details.ok, false);
assert.equal(missingCapability.details.error, "missing_capability");

const missingInstruction = await tool.execute("call-missing-instruction", {
  peerName: "node-b",
  capability: "can:test",
}, undefined, undefined);
assert.equal(missingInstruction.details.ok, false);
assert.equal(missingInstruction.details.error, "missing_instruction");

const notConnected = await tool.execute("call-not-connected", {
  peerName: "node-c",
  capability: "can:test",
  instruction: "Run tests",
}, undefined, undefined);
assert.equal(notConnected.details.ok, false);
assert.equal(notConnected.details.error, "not_connected_or_approved");
assert.deepEqual(notConnected.details.connectedPeers, ["node-b"]);
assert.equal(sent.length, 0);

const providedId = await tool.execute("call-provided-id", {
  peerName: " node-b ",
  capability: " can:test ",
  instruction: " Run tests ",
  requestId: " request-123 ",
}, undefined, undefined);
assert.equal(providedId.details.ok, true);
assert.equal(providedId.details.requestId, "request-123");
assert.equal(providedId.details.providedRequestId, true);
assert.equal(providedId.details.peerName, "node-b");
assert.equal(providedId.details.capability, "can:test");
assert.equal(providedId.details.instruction, "Run tests");
assert.deepEqual(sent.at(-1), {
  peerName: "node-b",
  capability: "can:test",
  instruction: "Run tests",
  requestId: "request-123",
  finalRequestId: "request-123",
});

const generatedId = await tool.execute("call-generated-id", {
  peerName: "node-b",
  capability: "can:lint",
  instruction: "Lint the project",
}, undefined, undefined);
assert.equal(generatedId.details.ok, true);
assert.equal(generatedId.details.requestId, "generated-id");
assert.equal(generatedId.details.providedRequestId, false);
assert.equal(sent.at(-1).requestId, undefined);

transport.failSend = true;
const sendFailed = await tool.execute("call-send-failed", {
  peerName: "node-b",
  capability: "can:deploy",
  instruction: "Deploy",
}, undefined, undefined);
assert.equal(sendFailed.details.ok, false);
assert.equal(sendFailed.details.error, "send_failed");

console.log("capability-request-tool tests passed");
