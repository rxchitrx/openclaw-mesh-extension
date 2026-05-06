import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { DiscoveryService } from "../discovery.js";

export function createMeshDiscoverTool(
  discovery: DiscoveryService,
  ctx: OpenClawPluginToolContext,
) {
  return {
    name: "mesh_discover",
    description: "List all OpenClaw nodes currently visible on the mesh network",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      const localNode = discovery.getLocalNode();
      const peers = discovery.getPeers();

      if (peers.length === 0) {
        return {
          ok: true,
          message: `You are running standalone. No other mesh nodes found.\n\nLocal node: ${localNode.name} (${localNode.host}:${localNode.port})`,
          localNode,
          peers: [],
        };
      }

      const peerList = peers.map((p) => `  • ${p.name} (${p.host}:${p.port})`).join("\n");

      return {
        ok: true,
        message: `Found ${peers.length} mesh node(s):\n\n${peerList}\n\nLocal node: ${localNode.name} (${localNode.host}:${localNode.port})`,
        localNode,
        peers,
      };
    },
  };
}
