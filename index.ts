import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createCRDT, type CRDTService } from "./src/crdt.js";
import { createDiscovery, type DiscoveryService } from "./src/discovery.js";
import { createFileWatcher, type FileWatcherService } from "./src/file-watcher.js";
import { createMeshBroadcastTool } from "./src/tools/broadcast.js";
import { createMeshDiscoverTool } from "./src/tools/discover.js";
import { createMeshStatusTool } from "./src/tools/status.js";
import { createMeshSyncTool } from "./src/tools/sync.js";
import { createTransport, type TransportService } from "./src/transport.js";

export type MeshConfig = {
  enabled?: boolean;
  nodeName?: string;
  port?: number;
  workspaceDir?: string;
};

export type MeshServices = {
  discovery: DiscoveryService;
  transport: TransportService;
  crdt: CRDTService;
  fileWatcher: FileWatcherService;
};

const meshPlugin = {
  id: "mesh",
  name: "OpenClaw Mesh",
  description: "P2P distributed file sync between OpenClaw nodes",
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
  register(api: OpenClawPluginApi) {
    const config = (api.pluginConfig as MeshConfig) || {};
    const logger = api.logger;

    if (config.enabled === false) {
      logger.info("Mesh extension disabled, skipping registration");
      return;
    }

    const nodeName = config.nodeName || `node-${process.pid}`;
    const port = config.port || 18790;
    const workspaceDir = config.workspaceDir || api.config.workspaceDir || process.cwd();

    api.logger.info(`Initializing mesh node: ${nodeName} on port ${port}`);

    // Initialize mesh services
    const discovery = createDiscovery({
      nodeName,
      port,
      logger: api.logger,
    });

    const crdt = createCRDT({
      nodeName,
      logger: api.logger,
    });

    const transport = createTransport({
      nodeName,
      port,
      crdt,
      logger: api.logger,
    });

    const fileWatcher = createFileWatcher({
      workspaceDir,
      crdt,
      logger: api.logger,
    });

    // Register tools
    api.registerTool((ctx) => createMeshDiscoverTool(discovery, ctx), { name: "mesh_discover" });
    api.registerTool(
      (ctx) => createMeshStatusTool({ discovery, transport, crdt, fileWatcher }, ctx),
      { name: "mesh_status" },
    );
    api.registerTool((ctx) => createMeshBroadcastTool(crdt, ctx), { name: "mesh_broadcast" });
    api.registerTool((ctx) => createMeshSyncTool(crdt, ctx), { name: "mesh_sync" });

    // Start services on gateway start
    api.on("gateway_start", async () => {
      try {
        logger.info(``);
        logger.info(`╔════════════════════════════════════════════════════════════╗`);
        logger.info(`║               🦞 OPENCLAW MESH EXTENSION                    ║`);
        logger.info(`╚════════════════════════════════════════════════════════════╝`);
        logger.info(``);
        logger.info(`Starting mesh services...`);
        logger.info(`   Node Name: ${nodeName}`);
        logger.info(`   Port: ${port}`);
        logger.info(`   Workspace: ${workspaceDir}`);
        logger.info(``);
        
        await discovery.start();
        await transport.start();
        await fileWatcher.start();
        
        logger.info(``);
        logger.info(`╔════════════════════════════════════════════════════════════╗`);
        logger.info(`║           ✅ MESH SERVICES STARTED SUCCESSFULLY              ║`);
        logger.info(`╚════════════════════════════════════════════════════════════╝`);
        logger.info(``);
      } catch (err) {
        logger.error(`❌ FAILED TO START MESH SERVICES: ${err}`);
        logger.error(`   Extension will continue but mesh features may not work`);
      }
    });

    // Stop services on gateway stop
    api.on("gateway_stop", async () => {
      try {
        await fileWatcher.stop();
        await transport.stop();
        await discovery.stop();
        api.logger.info("Mesh services stopped");
      } catch (err) {
        api.logger.error(`Error stopping mesh services: ${err}`);
      }
    });

    // Hook into heartbeat for periodic sync
    api.on("heartbeat_prompt_contribution", async () => {
      const peers = discovery.getPeers();
      const connections = transport.getConnections();
      const pendingDeltas = crdt.getPendingDeltas();
      
      logger.debug(`💓 HEARTBEAT: ${peers.length} peers, ${connections.length} connections, ${pendingDeltas.length} pending deltas`);
      
      try {
        // Scan for new peers
        await discovery.scan();
        
        // Reconnect to any lost peers
        await transport.maintainConnections();
        
        // Sync pending deltas
        await crdt.syncPendingDeltas();
      } catch (err) {
        logger.warn(`⚠️ HEARTBEAT ERROR: ${err}`);
      }
    });

    api.logger.info("Mesh extension registered successfully");
  },
};

export default meshPlugin;
