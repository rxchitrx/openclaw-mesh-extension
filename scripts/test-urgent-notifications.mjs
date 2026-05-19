import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS,
  createUrgentNotificationScheduler,
  formatUrgentMeshChatMessage,
  formatUrgentMeshSystemEvent,
  isUrgentMeshEvent,
} from "../dist/src/urgent-notifications.js";
import {
  createMeshSessionTargetStore,
} from "../dist/src/mesh-session-target.js";

assert.equal(isUrgentMeshEvent("peer_pending_approval"), true);
assert.equal(isUrgentMeshEvent("peer_disconnected"), true);
assert.equal(isUrgentMeshEvent("sync_failed"), true);
assert.equal(isUrgentMeshEvent("file_rejected"), true);
assert.equal(isUrgentMeshEvent("peer_approved"), true);
assert.equal(isUrgentMeshEvent("peer_denied"), true);
assert.equal(isUrgentMeshEvent("file_sent"), true);
assert.equal(isUrgentMeshEvent("file_received"), true);
assert.equal(isUrgentMeshEvent("discovery_warning"), true);
assert.equal(isUrgentMeshEvent("manifest_received"), false);
assert.equal(isUrgentMeshEvent("peer_connected"), false);

let currentSessionKey = "session-1";
let now = 10000;
const requests = [];
const systemEvents = [];
const scheduler = createUrgentNotificationScheduler({
  getSessionKey: () => currentSessionKey,
  enqueueSystemEvent: (text, options) => {
    systemEvents.push({ text, options });
    return true;
  },
  requestHeartbeat: (request) => requests.push(request),
  now: () => now,
  logger: { debug() {}, warn() {} },
});

const pendingEvent = {
  id: "evt-1",
  kind: "peer_pending_approval",
  peerName: "node-a",
  createdAt: now,
  message: "Peer 'node-a' from 192.168.29.10 wants to join the mesh.",
  details: { host: "192.168.29.10", fingerprint: "ABCD-1234-EF56" },
  delivered: false,
  acknowledged: false,
  occurrences: 1,
};

assert.equal(await scheduler.schedule(pendingEvent), true);
assert.equal(systemEvents.length, 1);
assert.match(systemEvents[0].text, /Mesh approval needed/);
assert.match(systemEvents[0].text, /node-a/);
assert.match(systemEvents[0].text, /ABCD-1234-EF56/);
assert.deepEqual(systemEvents[0].options, {
  sessionKey: "session-1",
  contextKey: "mesh:evt-1",
  trusted: true,
});
assert.deepEqual(requests[0], {
  source: "notifications-event",
  intent: "event",
  reason: "mesh-urgent-event",
  sessionKey: "session-1",
  heartbeat: { target: "last" },
  coalesceMs: 0,
});

assert.equal(await scheduler.schedule({ ...pendingEvent, id: "evt-2", kind: "manifest_received" }), false);
assert.equal(requests.length, 1);

assert.equal(await scheduler.schedule({ ...pendingEvent, id: "evt-3", kind: "sync_failed" }), false);
assert.equal(requests.length, 1);

now += DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS;
assert.equal(await scheduler.schedule({ ...pendingEvent, id: "evt-4", kind: "sync_failed", message: "Sync failed." }), true);
assert.equal(requests.length, 2);

currentSessionKey = null;
now += DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS;
assert.equal(await scheduler.schedule({ ...pendingEvent, id: "evt-5", kind: "file_rejected" }), false);
assert.equal(requests.length, 2);

const noRuntimeScheduler = createUrgentNotificationScheduler({
  getSessionKey: () => "session-2",
  now: () => now,
});
assert.equal(await noRuntimeScheduler.schedule({ ...pendingEvent, id: "evt-6" }), false);

const directRuns = [];
const directScheduler = createUrgentNotificationScheduler({
  getSessionKey: () => "session-3",
  enqueueSystemEvent: () => true,
  runHeartbeatOnce: async (request) => {
    directRuns.push(request);
    return { status: "ran", durationMs: 1 };
  },
  now: () => now + DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS,
});
assert.equal(await directScheduler.schedule({ ...pendingEvent, id: "evt-7" }), true);
assert.deepEqual(directRuns[0], {
  reason: "mesh-urgent-event",
  sessionKey: "session-3",
  heartbeat: { target: "last" },
});

const formattedMismatch = formatUrgentMeshSystemEvent({
  ...pendingEvent,
  id: "evt-8",
  details: { host: "192.168.29.11", fingerprint: "EEEE-FFFF-0000", fingerprintMismatch: true },
});
assert.match(formattedMismatch, /possible impersonation/i);

const approvedOutboundSystemText = formatUrgentMeshSystemEvent({
  ...pendingEvent, id: "evt-9", kind: "peer_approved",
  details: { direction: "outbound" },
});
assert.match(approvedOutboundSystemText, /You approved peer/);

const approvedOutboundChatText = formatUrgentMeshChatMessage({
  ...pendingEvent, id: "evt-10", kind: "peer_approved",
  details: { direction: "outbound" },
});
assert.match(approvedOutboundChatText, /You approved peer/);

const approvedInboundSystemText = formatUrgentMeshSystemEvent({
  ...pendingEvent, id: "evt-11", kind: "peer_approved",
  details: { direction: "inbound" },
});
assert.match(approvedInboundSystemText, /approved your connection/);

const approvedInboundChatText = formatUrgentMeshChatMessage({
  ...pendingEvent, id: "evt-12", kind: "peer_approved",
  details: { direction: "inbound" },
});
assert.match(approvedInboundChatText, /approved your connection/);

const deniedOutboundSystemText = formatUrgentMeshSystemEvent({
  ...pendingEvent, id: "evt-13", kind: "peer_denied",
  details: { direction: "outbound" },
});
assert.match(deniedOutboundSystemText, /You denied peer/);

const deniedOutboundChatText = formatUrgentMeshChatMessage({
  ...pendingEvent, id: "evt-14", kind: "peer_denied",
  details: { direction: "outbound" },
});
assert.match(deniedOutboundChatText, /You denied peer/);

const deniedInboundSystemText = formatUrgentMeshSystemEvent({
  ...pendingEvent, id: "evt-15", kind: "peer_denied",
  details: { direction: "inbound" },
});
assert.match(deniedInboundSystemText, /denied your connection/);

const deniedInboundChatText = formatUrgentMeshChatMessage({
  ...pendingEvent, id: "evt-16", kind: "peer_denied",
  details: { direction: "inbound" },
});
assert.match(deniedInboundChatText, /denied your connection/);

const fileSentSystemText = formatUrgentMeshSystemEvent({
  ...pendingEvent, id: "evt-17", kind: "file_sent",
  peerName: "node-b",
  filePath: "src/foo.ts",
});
assert.match(fileSentSystemText, /Sent file/);

const fileSentChatText = formatUrgentMeshChatMessage({
  ...pendingEvent, id: "evt-18", kind: "file_sent",
  peerName: "node-b",
  filePath: "src/foo.ts",
});
assert.match(fileSentChatText, /File sent/i);

const fileReceivedSystemText = formatUrgentMeshSystemEvent({
  ...pendingEvent, id: "evt-19", kind: "file_received",
  peerName: "node-b",
  filePath: "src/bar.ts",
});
assert.match(fileReceivedSystemText, /Received file/);

const fileReceivedChatText = formatUrgentMeshChatMessage({
  ...pendingEvent, id: "evt-20", kind: "file_received",
  peerName: "node-b",
  filePath: "src/bar.ts",
});
assert.match(fileReceivedChatText, /File received/i);

const discoveryWarningSystemText = formatUrgentMeshSystemEvent({
  ...pendingEvent, id: "evt-21", kind: "discovery_warning",
  message: "Network issue detected.",
});
assert.match(discoveryWarningSystemText, /discovery_warning|Warning/i);

const discoveryWarningChatText = formatUrgentMeshChatMessage({
  ...pendingEvent, id: "evt-22", kind: "discovery_warning",
  message: "Network issue detected.",
});
assert.match(discoveryWarningChatText, /Discovery warning/i);

const chatMessage = formatUrgentMeshChatMessage(pendingEvent);
assert.match(chatMessage, /Mesh approval needed/);
assert.match(chatMessage, /node-a/);
assert.match(chatMessage, /192\.168\.29\.10/);

const injectedMessages = [];
const webchatSystemEvents = [];
const webchatHeartbeats = [];
const webchatScheduler = createUrgentNotificationScheduler({
  getSessionKey: () => "session-webchat",
  getSessionTarget: () => ({
    sessionKey: "session-webchat",
    deliveryContext: { channel: "webchat" },
  }),
  injectChatMessage: async (request) => {
    injectedMessages.push(request);
    return true;
  },
  enqueueSystemEvent: (text, options) => {
    webchatSystemEvents.push({ text, options });
    return true;
  },
  requestHeartbeat: (request) => webchatHeartbeats.push(request),
  now: () => now + (DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS * 2),
});
assert.equal(await webchatScheduler.schedule({ ...pendingEvent, id: "evt-webchat" }), true);
assert.equal(injectedMessages.length, 1);
assert.equal(injectedMessages[0].sessionKey, "session-webchat");
assert.equal(injectedMessages[0].label, "Mesh");
assert.match(injectedMessages[0].message, /approve or deny/);
assert.equal(webchatSystemEvents.length, 0);
assert.equal(webchatHeartbeats.length, 0);

const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mesh-session-"));
try {
  const sessionStore = createMeshSessionTargetStore({
    baseDir: tempDir,
    ttlMs: 1000,
    now: () => 5000,
  });
  sessionStore.remember("session-persisted", "test", { channel: "webchat" });
  sessionStore.remember("session-persisted", "agent-event");
  assert.deepEqual(sessionStore.getCurrent()?.deliveryContext, { channel: "webchat" });
  const reloaded = createMeshSessionTargetStore({
    baseDir: tempDir,
    ttlMs: 1000,
    now: () => 5500,
  });
  assert.equal(reloaded.getCurrent()?.sessionKey, "session-persisted");
  const stale = createMeshSessionTargetStore({
    baseDir: tempDir,
    ttlMs: 1000,
    now: () => 7001,
  });
  assert.equal(stale.getCurrent(), null);
} finally {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
}

console.log("urgent-notifications tests passed");
