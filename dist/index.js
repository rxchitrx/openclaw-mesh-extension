import { createCRDT } from "./src/crdt.js";
import { createDiscovery } from "./src/discovery.js";
import { createFileWatcher } from "./src/file-watcher.js";
import { createMeshBroadcastTool } from "./src/tools/broadcast.js";
import { createMeshDiscoverTool } from "./src/tools/discover.js";
import { createMeshStatusTool } from "./src/tools/status.js";
import { createMeshSyncTool } from "./src/tools/sync.js";
import { createTransport } from "./src/transport.js";
const meshPlugin = {
    id: "mesh",
    name: "OpenClaw Mesh",
    description: "P2P distributed file sync between OpenClaw nodes — a local offline GitHub for project sharing",
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
            await fileWatcher.start();
            currentTrackDir = dir;
        };
        const stopFileWatcher = async () => {
            if (fileWatcher) {
                await fileWatcher.stop();
                fileWatcher = null;
            }
            currentTrackDir = null;
        };
        api.registerTool((ctx) => createMeshDiscoverTool(discovery, ctx), { name: "mesh_discover" });
        api.registerTool((ctx) => createMeshStatusTool({ discovery, transport, crdt, fileWatcher: fileWatcher, currentTrackDir }, ctx), { name: "mesh_status" });
        api.registerTool((ctx) => createMeshBroadcastTool(crdt, ctx), { name: "mesh_broadcast" });
        api.registerTool((ctx) => createMeshSyncTool(crdt, ctx), { name: "mesh_sync" });
        api.registerCommand({
            name: "mesh",
            description: "Manage mesh file tracking. Usage: /mesh dir <path> | /mesh stop | /mesh dir",
            acceptsArgs: true,
            handler: async (ctx) => {
                const rawArgs = ctx.args ?? "";
                const parts = rawArgs.trim().split(/\s+/);
                const subcommand = parts[0]?.toLowerCase();
                const arg = parts.slice(1).join(" ");
                switch (subcommand) {
                    case "dir": {
                        if (!arg) {
                            if (currentTrackDir) {
                                return `Tracking: ${currentTrackDir}`;
                            }
                            return "No directory is being tracked. Use: /mesh dir /path/to/project";
                        }
                        const path = await import("path");
                        const fs = await import("fs");
                        const resolved = path.resolve(arg.replace(/^~/, process.env.HOME || "~"));
                        try {
                            const stat = await fs.promises.stat(resolved);
                            if (!stat.isDirectory()) {
                                return `Not a directory: ${resolved}`;
                            }
                        }
                        catch {
                            return `Directory does not exist: ${resolved}`;
                        }
                        try {
                            await startFileWatcher(resolved);
                            logger.info(`Now tracking: ${resolved}`);
                            return `Now tracking: ${resolved}`;
                        }
                        catch (err) {
                            return `Failed to start tracking ${resolved}: ${err.message}`;
                        }
                    }
                    case "stop": {
                        if (!fileWatcher) {
                            return "Not tracking any directory.";
                        }
                        await stopFileWatcher();
                        return "Stopped tracking.";
                    }
                    case "":
                    case undefined: {
                        if (currentTrackDir) {
                            const watched = fileWatcher?.getWatchedFiles()?.length ?? 0;
                            const pending = crdt.getPendingDeltas().length;
                            return `Tracking: ${currentTrackDir} (${watched} files, ${pending} pending deltas)`;
                        }
                        return "No directory tracked. Use: /mesh dir /path/to/project";
                    }
                    default:
                        return `Unknown command: ${subcommand}\nUsage: /mesh dir <path> | /mesh stop | /mesh dir`;
                }
            },
        });
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
                    logger.info("No track directory configured. Use /mesh dir <path> to start tracking a project.");
                }
                logger.info(`Mesh services started successfully`);
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
            const pendingDeltas = crdt.getPendingDeltas();
            logger.debug(`Heartbeat: ${peers.length} peers, ${connections.length} connections, ${pendingDeltas.length} pending deltas`);
            try {
                await discovery.scan();
                await transport.maintainConnections();
                await crdt.syncPendingDeltas();
            }
            catch (err) {
                logger.warn(`Heartbeat error: ${err}`);
            }
        });
        logger.info("Mesh extension registered successfully");
    },
};
export default meshPlugin;
