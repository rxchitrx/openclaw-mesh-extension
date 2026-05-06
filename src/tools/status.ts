import type { DiscoveryService } from "../discovery.js";
import type { TransportService } from "../transport.js";
import type { CRDTService } from "../crdt.js";
import type { FileWatcherService } from "../file-watcher.js";

type MeshServices = {
  discovery: DiscoveryService;
  transport: TransportService;
  crdt: CRDTService;
  fileWatcher: FileWatcherService;
};

export function createMeshStatusTool(services: MeshServices, _ctx: any) {
  return {
    label: "Mesh Status",
    name: "mesh_status",
    description: "Show detailed mesh state for debugging",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
    execute: async (_toolCallId: string, _toolParams: any, _signal: any, _onUpdate: any) => {
      const { discovery, transport, crdt, fileWatcher } = services;

      const localNode = discovery.getLocalNode();
      const peers = discovery.getPeers();
      const connections = transport.getConnections();
      const files = crdt.getFiles();
      const pendingDeltas = crdt.getPendingDeltas();
      const watchedFiles = fileWatcher.getWatchedFiles();
      const now = new Date().toISOString();

      let message = `MESH STATUS REPORT\n`;
      message += `Timestamp: ${now}\n\n`;

      message += `LOCAL NODE\n`;
      message += `  Name: ${localNode.name}\n`;
      message += `  Host: ${localNode.host}\n`;
      message += `  Port: ${localNode.port}\n\n`;

      message += `NETWORK STATUS\n`;
      message += `  Discovered Peers: ${peers.length}\n`;
      message += `  Active Connections: ${connections.length}\n`;
      if (peers.length > 0) {
        message += `  Connection Rate: ${connections.length}/${peers.length} (${Math.round(connections.length / peers.length * 100)}%)\n`;
      }
      message += `\n`;

      if (connections.length > 0) {
        message += `ACTIVE CONNECTIONS\n`;
        for (const conn of connections) {
          message += `  ${conn}\n`;
        }
        message += `\n`;
      } else if (peers.length > 0) {
        message += `CONNECTIONS: None (but ${peers.length} peer(s) discovered, attempting to connect...)\n\n`;
      } else {
        message += `CONNECTIONS: None (no peers discovered)\n\n`;
      }

      message += `FILE SYNC STATUS\n`;
      message += `  Watched Files: ${watchedFiles.length}\n`;
      message += `  Synced Files (in CRDT): ${files.length}\n`;
      message += `  Pending Deltas: ${pendingDeltas.length}\n\n`;

      if (watchedFiles.length > 0) {
        message += `WATCHED FILES\n`;
        const maxShow = 15;
        const shown = watchedFiles.slice(0, maxShow);
        for (const f of shown) {
          const inCRDT = files.includes(f) ? "synced" : "pending";
          message += `  [${inCRDT}] ${f}\n`;
        }
        if (watchedFiles.length > maxShow) {
          message += `  ... and ${watchedFiles.length - maxShow} more\n`;
        }
        message += `\n`;
      }

      if (pendingDeltas.length > 0) {
        message += `PENDING DELTAS\n`;
        for (const delta of pendingDeltas.slice(0, 10)) {
          message += `  ${delta.file} (${delta.changes.length} changes, ${Math.floor((Date.now() - delta.timestamp) / 1000)}s ago)\n`;
        }
        if (pendingDeltas.length > 10) {
          message += `  ... and ${pendingDeltas.length - 10} more\n`;
        }
        message += `\n`;
      }

      const health = connections.length > 0 ? "HEALTHY" : (peers.length > 0 ? "PARTIAL" : "STANDALONE");
      message += `SUMMARY\n`;
      message += `  Health: ${health}\n`;
      message += `  Mode: ${connections.length > 0 ? "MESH" : "STANDALONE"}\n`;
      message += `  Sync Status: ${pendingDeltas.length === 0 ? "IN SYNC" : `${pendingDeltas.length} PENDING`}\n`;

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          status: {
            localNode,
            peerCount: peers.length,
            connectionCount: connections.length,
            syncedFiles: files.length,
            watchedFiles: watchedFiles.length,
            pendingDeltas: pendingDeltas.length,
            health,
            timestamp: now,
          },
        },
      };
    },
  };
}
