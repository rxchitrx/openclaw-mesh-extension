import type { TransportService } from "../transport.js";
import type { MeshEventStore } from "../events.js";

export function createMeshConnectionsTool(
  services: { transport: TransportService; eventStore: MeshEventStore },
  _ctx: any,
) {
  return {
    label: "Mesh Connections",
    name: "mesh_connections",
    description: "Inspect mesh peer connections, pending approvals, and remote manifest state",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
    execute: async (_toolCallId: string, _toolParams: any, _signal: any, _onUpdate: any) => {
      const { transport, eventStore } = services;
      const connections = transport.getConnections();
      const pending = transport.getPendingConnections();
      const recentEvents = eventStore.listRecent(20);
      const now = Date.now();

      let message = `MESH CONNECTIONS\n`;
      message += `Timestamp: ${new Date(now).toISOString()}\n\n`;

      if (pending.length > 0) {
        message += `PENDING APPROVALS\n`;
        for (const item of pending) {
          message += `  ${item.peerName} from ${item.host} (${Math.floor((now - item.connectedAt) / 1000)}s ago)\n`;
        }
        message += `\n`;
      } else {
        message += `PENDING APPROVALS\n  none\n\n`;
      }

      if (connections.length > 0) {
        message += `ACTIVE CONNECTIONS\n`;
        for (const peerName of connections) {
          const manifest = transport.getRemoteManifest(peerName);
          const info = transport.getNodeInfo(peerName);
          const applied = transport.getRemoteAppliedFiles(peerName);
          const lastEvent = recentEvents.find((event) => event.peerName === peerName);
          message += `  ${peerName}`;
          if (manifest) {
            message += ` | manifest: ${manifest.length} files`;
          }
          if (info) {
            const trackDir = info.trackingDir || "not tracking";
            message += ` | tracking: ${trackDir} (${info.trackingFileCount} files)`;
          }
          if (applied.length > 0) {
            message += ` | remote applied: ${applied.length}`;
          }
          if (lastEvent) {
            message += ` | last event: ${lastEvent.kind}`;
          }
          message += `\n`;
        }
      } else {
        message += `ACTIVE CONNECTIONS\n  none\n`;
      }

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          connections,
          pendingConnections: pending.map((item) => ({
            peerName: item.peerName,
            host: item.host,
            connectedAt: item.connectedAt,
          })),
        },
      };
    },
  };
}
