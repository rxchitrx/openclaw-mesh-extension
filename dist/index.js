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
    description: "P2P distributed file sync between OpenClaw nodes via mDNS discovery and WebSocket connections",
    configSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            enabled: { type: "boolean", default: true },
            nodeName: { type: "string" },
            port: { type: "number", default: 18790 },
            workspaceDir: { type: "string" },
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
        const workspaceDir = config.workspaceDir || process.env.OPENCLAW_WORKSPACE || process.cwd();
        logger.info(`Initializing mesh node: ${nodeName} on port ${port}`);
        const discovery = createDiscovery({
            nodeName,
            port,
            logger,
        });
        const crdt = createCRDT({
            nodeName,
            logger,
        });
        const transport = createTransport({
            nodeName,
            port,
            crdt,
            logger,
        });
        const fileWatcher = createFileWatcher({
            workspaceDir,
            crdt,
            logger,
        });
        api.registerTool((ctx) => createMeshDiscoverTool(discovery, ctx), { name: "mesh_discover" });
        api.registerTool((ctx) => createMeshStatusTool({ discovery, transport, crdt, fileWatcher }, ctx), { name: "mesh_status" });
        api.registerTool((ctx) => createMeshBroadcastTool(crdt, ctx), { name: "mesh_broadcast" });
        api.registerTool((ctx) => createMeshSyncTool(crdt, ctx), { name: "mesh_sync" });
        api.on("gateway_start", async () => {
            try {
                logger.info(`Starting mesh services... Node: ${nodeName}, Port: ${port}, Workspace: ${workspaceDir}`);
                await discovery.start();
                await transport.start();
                await fileWatcher.start();
                logger.info(`Mesh services started successfully`);
            }
            catch (err) {
                logger.error(`Failed to start mesh services: ${err}`);
                logger.error(`Extension will continue but mesh features may not work`);
            }
        });
        api.on("gateway_stop", async () => {
            try {
                await fileWatcher.stop();
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
