import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { CRDTService } from "../crdt.js";
import type { DiscoveryService } from "../discovery.js";
import type { FileWatcherService } from "../file-watcher.js";
import type { TransportService } from "../transport.js";

type MeshServices = {
  discovery: DiscoveryService;
  transport: TransportService;
  crdt: CRDTService;
  fileWatcher: FileWatcherService;
};

export function createMeshStatusTool(services: MeshServices, ctx: OpenClawPluginToolContext) {
  return {
    name: "mesh_status",
    description:
      "Show the current state of the local mesh node including connections, synced files, and pending deltas",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      const { discovery, transport, crdt, fileWatcher } = services;

      const localNode = discovery.getLocalNode();
      const peers = discovery.getPeers();
      const connections = transport.getConnections();
      const files = crdt.getFiles();
      const pendingDeltas = crdt.getPendingDeltas();
      const watchedFiles = fileWatcher.getWatchedFiles();

      let status = `📍 **Local Node:** ${localNode.name}\n`;
      status += `🌐 **Address:** ${localNode.host}:${localNode.port}\n\n`;

      status += `🔗 **Connections:** ${connections.length}/${peers.length}\n`;
      if (connections.length > 0) {
        status += connections.map((c) => `  • ${c}`).join("\n") + "\n";
      }
      status += "\n";

      status += `📁 **Synced Files:** ${files.length}\n`;
      if (files.length > 0) {
        const fileList = files
          .slice(0, 10)
          .map((f) => `  • ${f}`)
          .join("\n");
        status += fileList;
        if (files.length > 10) {
          status += `\n  ... and ${files.length - 10} more`;
        }
        status += "\n";
      }
      status += "\n";

      status += `👁️ **Watched Files:** ${watchedFiles.length}\n`;
      status += `⏳ **Pending Deltas:** ${pendingDeltas.length}\n`;

      return {
        ok: true,
        message: status,
        status: {
          localNode,
          peerCount: peers.length,
          connectionCount: connections.length,
          syncedFiles: files.length,
          watchedFiles: watchedFiles.length,
          pendingDeltas: pendingDeltas.length,
        },
      };
    },
  };
}
