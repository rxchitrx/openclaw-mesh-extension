import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createSyncState } from "./src/sync-state.js";
import { createDiscovery } from "./src/discovery.js";
import { createMeshEventStore, summarizeMeshEvents } from "./src/events.js";
import { createFileWatcher } from "./src/file-watcher.js";
import { createCapabilityRegistry } from "./src/capability-registry.js";
import { resolveInsideRoot } from "./src/path-safety.js";
import { createMeshAdvertiseTool } from "./src/tools/advertise.js";
import { createMeshApproveTool } from "./src/tools/approve.js";
import { createMeshConnectionsTool } from "./src/tools/connections.js";
import { createMeshCapabilityRespondTool } from "./src/tools/capability-respond.js";
import { createMeshDiffTool } from "./src/tools/diff.js";
import { createMeshDiscoverTool } from "./src/tools/discover.js";
import { createMeshEventsTool } from "./src/tools/events.js";
import { createMeshAckTool } from "./src/tools/ack.js";
import { createMeshBroadcastTool } from "./src/tools/broadcast.js";
import { createMeshRejectTool } from "./src/tools/reject.js";
import { createMeshStatusTool } from "./src/tools/status.js";
import { createMeshSyncTool } from "./src/tools/sync.js";
import { createMeshTrackTool } from "./src/tools/track.js";
import { createTransport } from "./src/transport.js";
import { DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS, createUrgentNotificationScheduler, } from "./src/urgent-notifications.js";
import { DEFAULT_NOTIFICATION_SESSION_TTL_MS, createMeshSessionTargetStore, } from "./src/mesh-session-target.js";
const execFileAsync = promisify(execFile);
function readSessionDeliveryContext(sessionKey) {
    const match = /^agent:([^:]+):/.exec(sessionKey);
    const agentId = match?.[1];
    if (!agentId)
        return undefined;
    try {
        const sessionStorePath = path.join(process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw"), "agents", agentId, "sessions", "sessions.json");
        const store = JSON.parse(fs.readFileSync(sessionStorePath, "utf-8"));
        return store?.[sessionKey]?.deliveryContext;
    }
    catch {
        return undefined;
    }
}
function mapTransportEventKind(type) {
    switch (type) {
        case "peer_pending":
            return "peer_pending_approval";
        case "peer_approved":
            return "peer_approved";
        case "peer_denied":
            return "peer_denied";
        case "peer_connected":
        case "node_info_received":
            return "peer_connected";
        case "peer_disconnected":
            return "peer_disconnected";
        case "manifest_received":
            return "manifest_received";
        case "sync_requested":
            return "sync_requested";
        case "sync_applied":
            return "sync_applied";
        case "sync_failed":
            return "sync_failed";
        case "file_sent":
        case "file_patch":
            return "file_sent";
        case "file_received":
            return "file_received";
        case "file_written":
            return "file_written";
        case "file_rejected":
            return "file_rejected";
        case "file_conflict":
        case "conflict":
            return "conflict";
        case "capability_execute_requested":
            return "capability_execute_requested";
        case "capability_execute_completed":
            return "capability_execute_completed";
        case "file_deleted":
            return "discovery_warning";
        default:
            return "discovery_warning";
    }
}
const meshPlugin = {
    id: "mesh",
    name: "OpenClaw Mesh",
    description: "P2P project file sharing between OpenClaw nodes — a local offline GitHub",
    configSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            enabled: { type: "boolean", default: true },
            nodeName: { type: "string" },
            port: { type: "number", default: 18790 },
            trackDir: { type: "string" },
            ignorePatterns: {
                type: "array",
                items: { type: "string" },
                default: [],
            },
            capabilities: {
                type: "array",
                items: { type: "string" },
                default: [],
            },
            urgentNotifyCooldownMs: { type: "number", default: DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS },
            notificationSessionTtlMs: { type: "number", default: DEFAULT_NOTIFICATION_SESSION_TTL_MS },
            signalUrl: { type: "string" },
        },
    },
    register(api) {
        const config = api.pluginConfig || {};
        const logger = api.logger;
        if (config.enabled === false) {
            logger.info("Mesh extension disabled, skipping registration");
            return;
        }
        const nodeName = process.env.MESH_NODE_NAME || config.nodeName || `node-${process.pid}`;
        const port = config.port || 18790;
        let currentTrackDir = config.trackDir || null;
        let currentSessionKey = null;
        const registeredSessionJobs = new Set();
        logger.info(`Initializing mesh node: ${nodeName} on port ${port}`);
        const discovery = createDiscovery({ nodeName, port, logger });
        const syncState = createSyncState({ nodeName, logger });
        const capabilityRegistry = createCapabilityRegistry(config.capabilities ?? []);
        const transport = createTransport({ nodeName, port, syncState, logger });
        // Wire up WebRTC signaling to transport
        transport.setWebRTCDialer(async (peerName) => {
            return await discovery.initiateWebRTCConnection(peerName);
        });
        discovery.onWebRTCConnection = (peerName, webrtcTransport, direction) => {
            transport.registerExternalTransport(peerName, webrtcTransport, direction, "signaling");
        };
        const eventStore = createMeshEventStore();
        const sessionTargets = createMeshSessionTargetStore({
            ttlMs: config.notificationSessionTtlMs ?? DEFAULT_NOTIFICATION_SESSION_TTL_MS,
            logger,
        });
        const getNotificationTarget = () => {
            if (currentSessionKey) {
                const persisted = sessionTargets.getCurrent();
                const deliveryContext = persisted?.sessionKey === currentSessionKey
                    ? persisted.deliveryContext ?? readSessionDeliveryContext(currentSessionKey)
                    : readSessionDeliveryContext(currentSessionKey);
                return {
                    sessionKey: currentSessionKey,
                    updatedAt: Date.now(),
                    source: "memory",
                    deliveryContext,
                };
            }
            const persisted = sessionTargets.getCurrent();
            if (!persisted)
                return null;
            return {
                ...persisted,
                deliveryContext: persisted.deliveryContext ?? readSessionDeliveryContext(persisted.sessionKey),
            };
        };
        const injectDashboardChatMessage = async (request) => {
            const params = {
                sessionKey: request.sessionKey,
                message: request.message,
                ...(request.label ? { label: request.label } : {}),
            };
            const { stdout } = await execFileAsync("openclaw", [
                "gateway",
                "call",
                "chat.inject",
                "--json",
                "--timeout",
                "10000",
                "--params",
                JSON.stringify(params),
            ], {
                timeout: 15000,
                maxBuffer: 1024 * 1024,
            });
            const parsed = JSON.parse(stdout);
            return parsed?.ok === true;
        };
        const urgentNotifications = createUrgentNotificationScheduler({
            getSessionKey: () => getNotificationTarget()?.sessionKey ?? null,
            getSessionTarget: getNotificationTarget,
            injectChatMessage: injectDashboardChatMessage,
            enqueueSystemEvent: api.runtime?.system?.enqueueSystemEvent,
            requestHeartbeat: api.runtime?.system?.requestHeartbeat,
            runHeartbeatOnce: api.runtime?.system?.runHeartbeatOnce,
            cooldownMs: config.urgentNotifyCooldownMs ?? DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS,
            logger,
        });
        let fileWatcher = null;
        const getTrackState = () => ({
            fileWatcher,
            currentTrackDir,
            startFileWatcher,
            stopFileWatcher,
        });
        const tryInjectDigest = async (force = false) => {
            const targetSessionKey = currentSessionKey ?? sessionTargets.getCurrent()?.sessionKey ?? null;
            if (!targetSessionKey || !api.enqueueNextTurnInjection) {
                return null;
            }
            const deliverable = force ? eventStore.getUnacknowledged() : eventStore.getDeliverable(Date.now());
            if (deliverable.length === 0) {
                return null;
            }
            const text = summarizeMeshEvents(deliverable);
            if (!text) {
                return null;
            }
            try {
                await api.enqueueNextTurnInjection({
                    sessionKey: targetSessionKey,
                    text,
                    placement: "append_context",
                    ttlMs: 300000,
                });
                eventStore.markDelivered(deliverable.map((event) => event.id), Date.now());
                return text;
            }
            catch (err) {
                logger.warn(`Could not inject mesh digest into ${targetSessionKey}: ${err}`);
                return null;
            }
        };
        const registerSessionJob = (sessionKey) => {
            if (!api.registerSessionSchedulerJob || registeredSessionJobs.has(sessionKey)) {
                return;
            }
            api.registerSessionSchedulerJob({
                id: `mesh-notifier:${sessionKey}`,
                sessionKey,
                kind: "nudge",
                description: "Track mesh notification ownership for this active session",
            });
            registeredSessionJobs.add(sessionKey);
        };
        const enqueueEvent = (kind, message, options) => {
            const record = eventStore.addEvent({
                kind,
                message,
                peerName: options?.peerName,
                filePath: options?.filePath,
                details: options?.details,
                expiresAt: options?.expiresAt,
            });
            void urgentNotifications.schedule(record).then(async (delivered) => {
                if (delivered) {
                    eventStore.markDelivered([record.id], Date.now());
                    return;
                }
                await tryInjectDigest(false);
            });
        };
        const rememberSession = (ctx, source = "tool") => {
            if (typeof ctx?.sessionKey !== "string" || ctx.sessionKey.length === 0) {
                return;
            }
            currentSessionKey = ctx.sessionKey;
            sessionTargets.remember(ctx.sessionKey, source, ctx.deliveryContext);
            registerSessionJob(ctx.sessionKey);
        };
        const registerMeshTool = (name, factory) => {
            api.registerTool((ctx) => {
                rememberSession(ctx, `tool:${name}`);
                const tool = factory(ctx);
                if (!tool?.execute) {
                    return tool;
                }
                return {
                    ...tool,
                    execute: async (...args) => {
                        rememberSession(ctx, `tool:${name}:execute`);
                        const result = await tool.execute(...args);
                        if (name === "mesh_discover") {
                            void surfaceToolResult("mesh_discover", result);
                        }
                        return result;
                    },
                };
            }, { name });
        };
        const extractToolText = (result) => {
            const content = Array.isArray(result?.content) ? result.content : [];
            const text = content
                .map((block) => typeof block?.text === "string" ? block.text : "")
                .filter(Boolean)
                .join("\n")
                .trim();
            return text.length > 0 ? text.slice(0, 6000) : null;
        };
        const surfaceToolResult = async (toolName, result) => {
            const targetSessionKey = currentSessionKey;
            const text = extractToolText(result);
            if (!targetSessionKey || !text || !api.enqueueNextTurnInjection) {
                return;
            }
            try {
                await api.enqueueNextTurnInjection({
                    sessionKey: targetSessionKey,
                    placement: "append_context",
                    ttlMs: 120000,
                    text: `[mesh] The user just ran ${toolName}. You MUST summarize the important result to the user in plain language now. Do not leave only the tool card visible.\n\n${text}`,
                });
                await api.runtime?.system?.runHeartbeatOnce?.({
                    reason: "mesh-tool-result-summary",
                    sessionKey: targetSessionKey,
                    heartbeat: { target: "last" },
                });
            }
            catch (err) {
                logger.warn(`Could not surface ${toolName} result: ${err}`);
            }
        };
        const startFileWatcher = async (dir) => {
            if (fileWatcher) {
                await fileWatcher.stop();
                fileWatcher = null;
            }
            fileWatcher = createFileWatcher({ workspaceDir: dir, syncState, logger, ignorePatterns: config.ignorePatterns });
            fileWatcher.onFileDeleted = (relativePath) => {
                transport.notifyFileDeleted(relativePath);
                enqueueEvent("file_written", `Local tracked file '${relativePath}' was deleted and peers were notified.`, {
                    filePath: relativePath,
                    details: { direction: "local-delete" },
                });
            };
            await fileWatcher.start();
            currentTrackDir = dir;
        };
        const stopFileWatcher = async () => {
            if (!fileWatcher) {
                currentTrackDir = null;
                return;
            }
            fileWatcher.onFileDeleted = null;
            await fileWatcher.stop();
            fileWatcher = null;
            currentTrackDir = null;
        };
        const getFileContent = async (relativePath) => {
            if (!fileWatcher)
                return null;
            return fileWatcher.getFileContent(relativePath);
        };
        const getLocalManifest = () => {
            if (!fileWatcher)
                return [];
            return fileWatcher.getManifest();
        };
        transport.setNotificationHandler((notification) => {
            const host = typeof notification.data?.host === "string" ? notification.data.host : undefined;
            if (notification.peerName && host) {
                discovery.notePeer({
                    name: notification.peerName,
                    host,
                    port,
                    source: "transport",
                });
            }
            enqueueEvent(mapTransportEventKind(notification.type), notification.message, {
                peerName: notification.peerName,
                filePath: notification.filePath,
                details: notification.data,
                expiresAt: notification.type === "peer_pending" ? Date.now() + 60000 : undefined,
            });
        });
        transport.setNodeInfoProvider(() => {
            const manifest = getLocalManifest();
            return {
                nodeName,
                trackingDir: currentTrackDir,
                trackingFileCount: manifest.length,
                trackingFiles: manifest.map((file) => file.relativePath),
                capabilities: capabilityRegistry.list(),
            };
        });
        transport.setFileContentProvider(async (relativePath) => getFileContent(relativePath));
        transport.setManifestProvider(() => getLocalManifest());
        transport.setFileWriter(async (relativePath, contentOrTempPath, isBinary, isTempFile) => {
            if (!currentTrackDir) {
                logger.warn(`Cannot write file ${relativePath}: no track directory set`);
                throw new Error("no_track_directory");
            }
            const filePath = resolveInsideRoot(currentTrackDir, relativePath);
            if (!filePath) {
                logger.warn(`Rejected unsafe received file path: ${relativePath}`);
                throw new Error("invalid_path");
            }
            const dir = path.dirname(filePath);
            await fs.promises.mkdir(dir, { recursive: true });
            if (isTempFile) {
                await fs.promises.rename(contentOrTempPath, filePath);
            }
            else if (isBinary) {
                await fs.promises.writeFile(filePath, Buffer.from(contentOrTempPath, "base64"));
            }
            else {
                await fs.promises.writeFile(filePath, contentOrTempPath, "utf-8");
            }
            logger.info(`Wrote received file to disk: ${filePath}`);
        });
        transport.setIgnoreNextChange((relativePath) => {
            if (fileWatcher) {
                fileWatcher.ignoreNextChange(relativePath);
            }
        });
        if (api.registerAgentEventSubscription) {
            api.registerAgentEventSubscription({
                id: "mesh-active-session",
                streams: ["lifecycle", "tool", "error"],
                handle(event) {
                    if (!event?.sessionKey) {
                        return;
                    }
                    currentSessionKey = event.sessionKey;
                    sessionTargets.remember(event.sessionKey, "agent-event", event.deliveryContext);
                    registerSessionJob(event.sessionKey);
                    void tryInjectDigest(true);
                },
            });
        }
        registerMeshTool("mesh_discover", (ctx) => createMeshDiscoverTool({ discovery, transport }, ctx));
        registerMeshTool("mesh_status", (ctx) => createMeshStatusTool({ discovery, transport, syncState, getTrackState, capabilityRegistry }, ctx));
        registerMeshTool("mesh_advertise", (ctx) => createMeshAdvertiseTool({ capabilityRegistry, transport }, ctx));
        registerMeshTool("mesh_capability_respond", (ctx) => createMeshCapabilityRespondTool(transport, ctx));
        registerMeshTool("mesh_broadcast", (ctx) => createMeshBroadcastTool({ syncState, transport, getFileContent, getLocalManifest }, ctx));
        registerMeshTool("mesh_sync", (ctx) => createMeshSyncTool({ syncState, transport, getFileContent, getLocalManifest }, ctx));
        registerMeshTool("mesh_track", (ctx) => createMeshTrackTool(getTrackState, ctx));
        registerMeshTool("mesh_approve", (ctx) => createMeshApproveTool(transport, ctx));
        registerMeshTool("mesh_reject", (ctx) => createMeshRejectTool(transport, ctx));
        registerMeshTool("mesh_connections", (ctx) => createMeshConnectionsTool({ transport, eventStore }, ctx));
        registerMeshTool("mesh_diff", (ctx) => createMeshDiffTool({ transport, syncState, getLocalManifest, getFileContent }, ctx));
        registerMeshTool("mesh_events", (ctx) => createMeshEventsTool(eventStore, ctx));
        registerMeshTool("mesh_ack", (ctx) => createMeshAckTool(eventStore, ctx));
        api.on("gateway_start", async () => {
            try {
                logger.info(`Starting mesh services... Node: ${nodeName}, Port: ${port}`);
                await discovery.start();
                const targetSignalUrl = config.signalUrl || process.env.SIGNAL_URL;
                if (targetSignalUrl) {
                    logger.info(`Connecting to signaling server at ${targetSignalUrl}`);
                    await discovery.connectSignaling(targetSignalUrl);
                }
                await transport.start();
                if (currentTrackDir) {
                    await startFileWatcher(currentTrackDir);
                    logger.info(`Auto-tracking directory: ${currentTrackDir}`);
                }
                else {
                    logger.info("No track directory configured. Tell me to track a project directory to get started.");
                }
                setTimeout(async () => {
                    await discovery.scan();
                    const discoveredPeers = discovery.getPeers();
                    for (const peer of discoveredPeers) {
                        const connections = transport.getConnections();
                        const pending = transport.getPendingConnections();
                        if (!connections.includes(peer.name) && !pending.some((item) => item.peerName === peer.name)) {
                            await transport.connectToPeer(peer);
                        }
                    }
                }, 5000);
            }
            catch (err) {
                logger.error(`Failed to start mesh services: ${err}`);
            }
        });
        api.on("gateway_stop", async () => {
            try {
                await stopFileWatcher();
                await transport.stop();
                await discovery.stop();
                logger.info("Mesh services stopped");
            }
            catch (err) {
                logger.error(`Error stopping mesh services: ${err}`);
            }
        });
        api.on("heartbeat_prompt_contribution", async () => {
            const peers = discovery.getPeers();
            const connections = transport.getConnections();
            const pending = transport.getPendingConnections();
            const pendingChanges = syncState.getPendingChanges();
            logger.debug(`Heartbeat: ${peers.length} peers, ${connections.length} connections, ${pendingChanges.length} pending changes, ${pending.length} pending approvals`);
            try {
                await discovery.scan();
                await transport.maintainConnections();
                for (const peer of discovery.getPeers()) {
                    if (!connections.includes(peer.name) && !pending.some((item) => item.peerName === peer.name)) {
                        await transport.connectToPeer(peer);
                    }
                }
            }
            catch (err) {
                logger.warn(`Heartbeat error: ${err}`);
            }
            await tryInjectDigest(false);
            const parts = [];
            const unreadEvents = eventStore.listUnread();
            if (pending.length > 0) {
                const names = pending.map((item) => item.peerName).join(", ");
                parts.push(`${pending.length} peer(s) awaiting approval: ${names}. Ask the user if they want to approve or deny.`);
            }
            if (unreadEvents.length > 0 && !currentSessionKey) {
                parts.push(`${unreadEvents.length} unread mesh event(s) are queued, but there is no active session target yet.`);
            }
            if (pendingChanges.length > 0) {
                parts.push(`${pendingChanges.length} pending file change(s) not yet broadcast. Ask the user if they want to broadcast.`);
            }
            if (parts.length > 0) {
                return {
                    appendContext: `[mesh heartbeat] IMPORTANT — You MUST immediately tell the user about the following. Do NOT keep this to yourself: ${parts.join(" ")}`,
                };
            }
            return {};
        });
        logger.info("Mesh extension registered successfully");
    },
};
export default meshPlugin;
