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
  description: "P2P distributed file sync between OpenClaw nodes via mDNS discovery and WebSocket connections",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      nodeName: { type: "string" },
      port: { type: "number", default: 18790 },
      workspaceDir: { type: "string" },
    },
  },
  register(api: any) {
    const config = (api.pluginConfig as MeshConfig) || {};
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

    api.registerTool((ctx: any) => createMeshDiscoverTool(discovery, ctx), { name: "mesh_discover" });
    api.registerTool(
      (ctx: any) => createMeshStatusTool({ discovery, transport, crdt, fileWatcher }, ctx),
      { name: "mesh_status" },
    );
    api.registerTool((ctx: any) => createMeshBroadcastTool(crdt, ctx), { name: "mesh_broadcast" });
    api.registerTool((ctx: any) => createMeshSyncTool(crdt, ctx), { name: "mesh_sync" });

    api.on("gateway_start", async () => {
      try {
        logger.info(`Starting mesh services... Node: ${nodeName}, Port: ${port}, Workspace: ${workspaceDir}`);

        await discovery.start();
        await transport.start();
        await fileWatcher.start();

        logger.info(`Mesh services started successfully`);
      } catch (err) {
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
      } catch (err) {
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
      } catch (err) {
        logger.warn(`Heartbeat error: ${err}`);
      }
    });

    logger.info("Mesh extension registered successfully");
  },
};

export default meshPlugin;
