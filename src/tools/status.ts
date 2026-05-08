import type { DiscoveryService } from "../discovery.js";
import type { TransportService } from "../transport.js";
import type { SyncStateService } from "../sync-state.js";
import type { FileWatcherService } from "../file-watcher.js";
import type { MeshEventStore } from "../events.js";

type TrackState = {
  fileWatcher: FileWatcherService | null;
  currentTrackDir: string | null;
  startFileWatcher: (dir: string) => Promise<void>;
  stopFileWatcher: () => Promise<void>;
};

type MeshServices = {
  discovery: DiscoveryService;
  transport: TransportService;
  syncState: SyncStateService;
  getTrackState: () => TrackState;
  eventStore?: MeshEventStore;
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
      const { discovery, transport, syncState, getTrackState } = services;
      const { fileWatcher, currentTrackDir } = getTrackState();

      const localNode = discovery.getLocalNode();
      const peers = discovery.getPeers();
      const connections = transport.getConnections();
      const pending = transport.getPendingConnections();
      const watchedFiles = fileWatcher?.getWatchedFiles() ?? [];
      const pendingChanges = syncState.getPendingChanges();
      const eventStats = services.eventStore?.getStats();
      const recentEvents = services.eventStore?.listUnread().slice(0, 5) ?? [];
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
          message += `    ${p.name} at ${p.host}:${p.port} ${connected ? "[connected]" : ""}\n`;
        }
      }
      message += `  Connected: ${connections.length}\n`;
      if (connections.length > 0) {
        for (const name of connections) {
          const manifest = transport.getRemoteManifest(name);
          const info = transport.getNodeInfo(name);
          message += `    ${name}`;
          if (info) {
            const dirStr = info.trackingDir || "not tracking";
            message += ` | tracking: ${dirStr} (${info.trackingFileCount} files)`;
          }
          message += manifest ? ` | manifest: ${manifest.length} files` : " | manifest: none";
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

      message += `EVENTS\n`;
      message += `  Unread: ${eventStats?.unreadCount ?? 0}\n`;
      message += `  Undelivered: ${eventStats?.undeliveredCount ?? 0}\n`;
      if (eventStats?.lastDeliveredAt) {
        message += `  Last delivered: ${new Date(eventStats.lastDeliveredAt).toISOString()}\n`;
      }
      if (eventStats?.lastAcknowledgedAt) {
        message += `  Last acknowledged: ${new Date(eventStats.lastAcknowledgedAt).toISOString()}\n`;
      }
      if (recentEvents.length > 0) {
        message += `  Recent unread:\n`;
        for (const event of recentEvents) {
          message += `    ${event.kind}${event.peerName ? ` from ${event.peerName}` : ""}: ${event.message}\n`;
        }
      }
      message += `\n`;

      message += `FILE SYNC\n`;
      message += `  Watched: ${watchedFiles.length}\n`;
      message += `  Pending changes: ${pendingChanges.length}\n`;

      const health = connections.length > 0 ? "HEALTHY" : (peers.length > 0 ? "PARTIAL" : "STANDALONE");
      message += `\nSUMMARY: ${health} | ${connections.length > 0 ? "MESH" : "STANDALONE"} | ${pendingChanges.length === 0 ? "IN SYNC" : `${pendingChanges.length} PENDING`}${pending.length > 0 ? ` | ${pending.length} PENDING APPROVAL` : ""}\n`;

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
            unreadEventCount: eventStats?.unreadCount ?? 0,
            undeliveredEventCount: eventStats?.undeliveredCount ?? 0,
            lastDeliveredEventAt: eventStats?.lastDeliveredAt ?? null,
            lastAcknowledgedEventAt: eventStats?.lastAcknowledgedAt ?? null,
            watchedFiles: watchedFiles.length,
            pendingChanges: pendingChanges.length,
            health,
            timestamp: now,
          },
        },
      };
    },
  };
}
