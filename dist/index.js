import * as fs from "fs";
import * as path from "path";
import { createSyncState } from "./src/sync-state.js";
import { createDiscovery } from "./src/discovery.js";
import { createMeshEventStore, summarizeMeshEvents } from "./src/events.js";
import { createFileWatcher } from "./src/file-watcher.js";
import { createMeshApproveTool } from "./src/tools/approve.js";
import { createMeshConnectionsTool } from "./src/tools/connections.js";
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
            return "file_sent";
        case "file_received":
            return "file_received";
        case "file_written":
            return "file_written";
        case "file_conflict":
        case "conflict":
            return "conflict";
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
        },
    },
    register(api) {
        const config = api.pluginConfig || {};
        const logger = api.logger;
        if (config.enabled === false) {
            logger.info("Mesh extension disabled, skipping registration");
            return;
        }
        const nodeName = config.nodeName || `node-${process.pid}`;
        const port = config.port || 18790;
        let currentTrackDir = config.trackDir || null;
        let currentSessionKey = null;
        const registeredSessionJobs = new Set();
        logger.info(`Initializing mesh node: ${nodeName} on port ${port}`);
        const discovery = createDiscovery({ nodeName, port, logger });
        const syncState = createSyncState({ nodeName, logger });
        const transport = createTransport({ nodeName, port, syncState, logger });
        const eventStore = createMeshEventStore();
        let fileWatcher = null;
        const getTrackState = () => ({
            fileWatcher,
            currentTrackDir,
            startFileWatcher,
            stopFileWatcher,
        });
        const tryInjectDigest = async (force = false) => {
            const targetSessionKey = currentSessionKey;
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
            eventStore.addEvent({
                kind,
                message,
                peerName: options?.peerName,
                filePath: options?.filePath,
                details: options?.details,
                expiresAt: options?.expiresAt,
            });
            void tryInjectDigest(false);
        };
        const startFileWatcher = async (dir) => {
            if (fileWatcher) {
                await fileWatcher.stop();
                fileWatcher = null;
            }
            fileWatcher = createFileWatcher({ workspaceDir: dir, syncState, logger });
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
            };
        });
        transport.setFileContentProvider(async (relativePath) => getFileContent(relativePath));
        transport.setManifestProvider(() => getLocalManifest());
        transport.setFileWriter(async (relativePath, content, isBinary) => {
            if (!currentTrackDir) {
                logger.warn(`Cannot write file ${relativePath}: no track directory set`);
                throw new Error("no_track_directory");
            }
            const filePath = path.join(currentTrackDir, relativePath);
            const dir = path.dirname(filePath);
            await fs.promises.mkdir(dir, { recursive: true });
            if (isBinary) {
                await fs.promises.writeFile(filePath, Buffer.from(content, "base64"));
            }
            else {
                await fs.promises.writeFile(filePath, content, "utf-8");
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
                    registerSessionJob(event.sessionKey);
                    void tryInjectDigest(true);
                },
            });
        }
        api.registerTool((ctx) => createMeshDiscoverTool({ discovery, transport }, ctx), { name: "mesh_discover" });
        api.registerTool((ctx) => createMeshStatusTool({ discovery, transport, syncState, getTrackState }, ctx), { name: "mesh_status" });
        api.registerTool((ctx) => createMeshBroadcastTool({ syncState, transport, getFileContent, getLocalManifest, nodeName }, ctx), { name: "mesh_broadcast" });
        api.registerTool((ctx) => createMeshSyncTool({ syncState, transport, getFileContent, getLocalManifest }, ctx), { name: "mesh_sync" });
        api.registerTool((ctx) => createMeshTrackTool(getTrackState, ctx), { name: "mesh_track" });
        api.registerTool((ctx) => createMeshApproveTool(transport, ctx), { name: "mesh_approve" });
        api.registerTool((ctx) => createMeshRejectTool(transport, ctx), { name: "mesh_reject" });
        api.registerTool((ctx) => createMeshConnectionsTool({ transport, eventStore }, ctx), {
            name: "mesh_connections",
        });
        api.registerTool((ctx) => createMeshDiffTool({ transport, syncState, getLocalManifest }, ctx), { name: "mesh_diff" });
        api.registerTool((ctx) => createMeshEventsTool(eventStore, ctx), { name: "mesh_events" });
        api.registerTool((ctx) => createMeshAckTool(eventStore, ctx), { name: "mesh_ack" });
        api.on("gateway_start", async () => {
            try {
                logger.info(`Starting mesh services... Node: ${nodeName}, Port: ${port}`);
                await discovery.start();
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
