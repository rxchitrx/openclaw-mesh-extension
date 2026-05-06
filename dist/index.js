import { createCRDT } from "./src/crdt.js";
import { createDiscovery } from "./src/discovery.js";
import { createFileWatcher } from "./src/file-watcher.js";
import { createMeshBroadcastTool } from "./src/tools/broadcast.js";
import { createMeshDiscoverTool } from "./src/tools/discover.js";
import { createMeshStatusTool } from "./src/tools/status.js";
import { createMeshSyncTool } from "./src/tools/sync.js";
import { createMeshTrackTool } from "./src/tools/track.js";
import { createMeshApproveTool } from "./src/tools/approve.js";
import { createMeshDiffTool } from "./src/tools/diff.js";
import { createTransport } from "./src/transport.js";
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
        logger.info(`Initializing mesh node: ${nodeName} on port ${port}`);
        const discovery = createDiscovery({ nodeName, port, logger });
        const crdt = createCRDT({ nodeName, logger });
        const transport = createTransport({ nodeName, port, crdt, logger });
        let fileWatcher = null;
        const startFileWatcher = async (dir) => {
            if (fileWatcher) {
                await fileWatcher.stop();
                fileWatcher = null;
            }
            fileWatcher = createFileWatcher({ workspaceDir: dir, crdt, logger });
            fileWatcher.onFileDeleted = (relativePath) => {
                transport.notifyFileDeleted(relativePath);
                tryInjectNotification(`File deleted in tracked directory: '${relativePath}'. Connected peers will be notified.`);
            };
            await fileWatcher.start();
            currentTrackDir = dir;
        };
        const stopFileWatcher = async () => {
            if (fileWatcher) {
                fileWatcher.onFileDeleted = null;
                await fileWatcher.stop();
                fileWatcher = null;
            }
            currentTrackDir = null;
        };
        const getTrackState = () => ({
            fileWatcher,
            currentTrackDir,
            startFileWatcher,
            stopFileWatcher,
        });
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
        const tryInjectNotification = (text) => {
            try {
                if (api.enqueueNextTurnInjection) {
                    api.enqueueNextTurnInjection({
                        sessionKey: "default",
                        text: `[mesh] ${text}`,
                        placement: "append_context",
                        ttlMs: 300000,
                    });
                }
            }
            catch (err) {
                logger.debug(`Could not inject notification: ${err}`);
            }
        };
        transport.setNotificationHandler((notification) => {
            tryInjectNotification(notification.message);
        });
        api.registerTool((ctx) => createMeshDiscoverTool({ discovery, transport }, ctx), { name: "mesh_discover" });
        api.registerTool((ctx) => createMeshStatusTool({ discovery, transport, crdt, getTrackState }, ctx), { name: "mesh_status" });
        api.registerTool((ctx) => createMeshBroadcastTool({ crdt, transport, getFileContent }, ctx), { name: "mesh_broadcast" });
        api.registerTool((ctx) => createMeshSyncTool({ crdt, transport, getFileContent, getLocalManifest }, ctx), { name: "mesh_sync" });
        api.registerTool((ctx) => createMeshTrackTool(getTrackState, ctx), { name: "mesh_track" });
        api.registerTool((ctx) => createMeshApproveTool(transport, ctx), { name: "mesh_approve" });
        api.registerTool((ctx) => createMeshDiffTool({ transport, getLocalManifest }, ctx), { name: "mesh_diff" });
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
                logger.info(`Mesh services started successfully`);
                setTimeout(async () => {
                    await discovery.scan();
                    const discoveredPeers = discovery.getPeers();
                    for (const peer of discoveredPeers) {
                        const connections = transport.getConnections();
                        const pending = transport.getPendingConnections();
                        if (!connections.includes(peer.name) && !pending.some((p) => p.peerName === peer.name)) {
                            logger.info(`Auto-connecting to discovered peer: ${peer.name} at ${peer.host}:${peer.port}`);
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
            const pendingDeltas = crdt.getPendingDeltas();
            logger.debug(`Heartbeat: ${peers.length} peers, ${connections.length} connections, ${pendingDeltas.length} pending deltas, ${pending.length} pending approvals`);
            try {
                await discovery.scan();
                await transport.maintainConnections();
                await crdt.syncPendingDeltas();
                const discoveredPeers = discovery.getPeers();
                for (const peer of discoveredPeers) {
                    if (!connections.includes(peer.name) && !pending.some((p) => p.peerName === peer.name)) {
                        await transport.connectToPeer(peer);
                    }
                }
            }
            catch (err) {
                logger.warn(`Heartbeat error: ${err}`);
            }
            const parts = [];
            if (pending.length > 0) {
                const names = pending.map((p) => p.peerName).join(", ");
                parts.push(`${pending.length} peer(s) awaiting approval: ${names}. Say 'approve <name>' or 'deny <name>'.`);
            }
            if (pendingDeltas.length > 0) {
                parts.push(`${pendingDeltas.length} pending file change(s) not yet broadcast. Say 'broadcast' to push to peers.`);
            }
            if (parts.length > 0) {
                return {
                    appendContext: `[mesh heartbeat] ${parts.join(" ")}`,
                };
            }
            return {};
        });
        logger.info("Mesh extension registered successfully");
    },
};
export default meshPlugin;
