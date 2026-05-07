import type { DiscoveryService } from "../discovery.js";
import type { MeshEventStore } from "../events.js";
import type { TransportService } from "../transport.js";
import type { CRDTService } from "../crdt.js";
import type { FileWatcherService, TrackedFile } from "../file-watcher.js";

type TrackState = {
  fileWatcher: FileWatcherService | null;
  currentTrackDir: string | null;
  startFileWatcher: (dir: string) => Promise<void>;
  stopFileWatcher: () => Promise<void>;
};

type MeshServices = {
  discovery: DiscoveryService;
  transport: TransportService;
  crdt: CRDTService;
  getTrackState: () => TrackState;
  eventStore: MeshEventStore;
};

export function createMeshStatusTool(services: MeshServices, _ctx: any) {
  return {
    label: "Mesh Status",
    name: "mesh_status",
    description: "Show current mesh state — tracked directory, peers, connections, pending approvals, and file sync status",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
    execute: async (_toolCallId: string, _toolParams: any, _signal: any, _onUpdate: any) => {
      const { discovery, transport, crdt, getTrackState, eventStore } = services;
      const { fileWatcher, currentTrackDir } = getTrackState();

      const localNode = discovery.getLocalNode();
      const peers = discovery.getPeers();
      const connections = transport.getConnections();
      const pending = transport.getPendingConnections();
      const files = crdt.getFiles();
      const pendingDeltas = crdt.getPendingDeltas();
      const watchedFiles = fileWatcher?.getWatchedFiles() ?? [];
      const unreadEvents = eventStore.listUnread();
      const recentEvents = eventStore.listRecent(5);
      const eventStats = eventStore.getStats();
      const now = new Date().toISOString();

      let message = `MESH STATUS\n`;
      message += `Timestamp: ${now}\n\n`;

      message += `TRACKED DIRECTORY\n`;
      if (currentTrackDir) {
        message += `  ${currentTrackDir} (${watchedFiles.length} files)\n\n`;
      } else {
        message += `  None — tell me to track a project directory to get started\n\n`;
      }

      message += `LOCAL NODE\n`;
      message += `  Name: ${localNode.name}\n`;
      message += `  Host: ${localNode.host}\n`;
      message += `  Port: ${localNode.port}\n\n`;

      message += `NETWORK\n`;
      message += `  Discovered peers: ${peers.length}\n`;
      if (peers.length > 0) {
        for (const p of peers) {
          const connected = connections.includes(p.name);
          const source = p.source ? ` source=${p.source}` : "";
          message += `    ${p.name} at ${p.host}:${p.port} ${connected ? "[connected]" : ""}${source}\n`;
        }
      }
      message += `  Connected: ${connections.length}\n`;
      if (connections.length > 0) {
        for (const name of connections) {
          const manifest = transport.getRemoteManifest(name);
          const info = transport.getNodeInfo(name);
          const applied = transport.getRemoteAppliedFiles(name);
          message += `    ${name} ${manifest ? `(${manifest.length} files)` : "(no manifest)"}`;
          if (info) {
            const dirStr = info.trackingDir || "not tracking";
            message += ` | tracking: ${dirStr} (${info.trackingFileCount} files)`;
          }
          if (applied.length > 0) {
            message += ` | remote applied: ${applied.length}`;
          }
          message += `\n`;
        }
      }

      if (pending.length > 0) {
        message += `  PENDING APPROVAL: ${pending.length}\n`;
        for (const p of pending) {
          message += `    ${p.peerName} from ${p.host}\n`;
        }
      }
      message += `\n`;

      message += `FILE SYNC\n`;
      message += `  Watched: ${watchedFiles.length}\n`;
      message += `  In CRDT: ${files.length}\n`;
      message += `  Pending deltas: ${pendingDeltas.length}\n`;
      message += `  Unread events: ${eventStats.unreadCount}\n`;
      message += `  Undelivered events: ${eventStats.undeliveredCount}\n`;

      const binaryCount = files.filter((f: string) => crdt.isFileBinary(f)).length;
      if (binaryCount > 0) {
        message += `  Binary files: ${binaryCount}\n`;
      }

      if (recentEvents.length > 0) {
        message += `\nRECENT EVENTS\n`;
        for (const event of recentEvents) {
          const peer = event.peerName ? ` (${event.peerName})` : "";
          const filePath = event.filePath ? ` [${event.filePath}]` : "";
          const state = event.acknowledged ? "ack" : event.delivered ? "delivered" : "queued";
          message += `  ${event.kind}${peer}${filePath} - ${state}\n`;
        }
      }

      if (unreadEvents.length > 0 && eventStats.undeliveredCount > 0) {
        message += `\nNOTICE: ${eventStats.undeliveredCount} unread mesh event(s) have not been delivered to an active session yet.\n`;
      }

      const health = connections.length > 0 ? "HEALTHY" : (peers.length > 0 ? "PARTIAL" : "STANDALONE");
      message += `\nSUMMARY: ${health} | ${connections.length > 0 ? "MESH" : "STANDALONE"} | ${pendingDeltas.length === 0 ? "IN SYNC" : `${pendingDeltas.length} PENDING`}${pending.length > 0 ? ` | ${pending.length} PENDING APPROVAL` : ""}${eventStats.unreadCount > 0 ? ` | ${eventStats.unreadCount} UNREAD EVENTS` : ""}\n`;

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          status: {
            localNode,
            trackDir: currentTrackDir,
            peerCount: peers.length,
            connectionCount: connections.length,
            pendingApprovalCount: pending.length,
            unreadEventCount: eventStats.unreadCount,
            undeliveredEventCount: eventStats.undeliveredCount,
            lastDeliveredEventAt: eventStats.lastDeliveredAt,
            lastAcknowledgedEventAt: eventStats.lastAcknowledgedAt,
            syncedFiles: files.length,
            watchedFiles: watchedFiles.length,
            pendingDeltas: pendingDeltas.length,
            binaryFiles: binaryCount,
            health,
            timestamp: now,
          },
        },
      };
    },
  };
}
