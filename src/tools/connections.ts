import type { TransportService } from "../transport.js";

export function createMeshConnectionsTool(transport: TransportService, _ctx: any) {
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
      const connections = transport.getConnections();
      const pending = transport.getPendingConnections();
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
          message += `  ${peerName}`;
          if (manifest) {
            message += ` | manifest: ${manifest.length} files`;
          }
          if (info) {
            const trackDir = info.trackingDir || "not tracking";
            message += ` | tracking: ${trackDir} (${info.trackingFileCount} files)`;
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
