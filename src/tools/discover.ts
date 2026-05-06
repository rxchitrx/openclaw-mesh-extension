import type { DiscoveryService } from "../discovery.js";

export function createMeshDiscoverTool(discovery: DiscoveryService, _ctx: any) {
  return {
    label: "Mesh Discover",
    name: "mesh_discover",
    description: "List all OpenClaw nodes currently visible on the mesh network",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
    execute: async (_toolCallId: string, _toolParams: any, _signal: any, _onUpdate: any) => {
      await discovery.scan();
      const localNode = discovery.getLocalNode();
      const peers = discovery.getPeers();
      const now = new Date().toISOString();

      let message = `MESH DISCOVERY REPORT\n`;
      message += `Timestamp: ${now}\n\n`;

      message += `LOCAL NODE\n`;
      message += `  Name: ${localNode.name}\n`;
      message += `  Host: ${localNode.host}\n`;
      message += `  Port: ${localNode.port}\n\n`;

      if (peers.length === 0) {
        message += `PEERS: None found\n`;
        message += `  Status: Running in standalone mode\n`;
        message += `  No other OpenClaw nodes detected on this network.\n`;
        message += `  Make sure other nodes are on the same WiFi, running OpenClaw with mesh extension, and not blocked by firewall.\n`;
      } else {
        message += `PEERS: ${peers.length} found\n`;

        for (const peer of peers) {
          const ago = Math.floor((Date.now() - peer.lastSeen) / 1000);
          message += `\n  ${peer.name}\n`;
          message += `    Host: ${peer.host}\n`;
          message += `    Port: ${peer.port}\n`;
          message += `    Last seen: ${ago}s ago\n`;
        }
      }

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          localNode,
          peers,
          timestamp: now,
        },
      };
    },
  };
}
