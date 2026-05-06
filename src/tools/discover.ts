import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { DiscoveryService } from "../discovery.js";

export function createMeshDiscoverTool(discovery: DiscoveryService, ctx: OpenClawPluginToolContext) {
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
      const now = new Date().toISOString();
      
      let message = `🔍 MESH DISCOVERY REPORT\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `⏰ Timestamp: ${now}\n\n`;
      
      message += `📍 LOCAL NODE\n`;
      message += `   Name: ${localNode.name}\n`;
      message += `   Host: ${localNode.host}\n`;
      message += `   Port: ${localNode.port}\n\n`;
      
      if (peers.length === 0) {
        message += `🔌 PEERS: None found\n`;
        message += `   Status: Running in standalone mode\n`;
        message += `   Reason: No other OpenClaw nodes detected on this network\n\n`;
        message += `💡 TIP: Make sure other nodes are:\n`;
        message += `   • On the same WiFi network\n`;
        message += `   • Running OpenClaw with mesh extension\n`;
        message += `   • Not blocked by firewall\n`;
      } else {
        message += `🔌 PEERS: ${peers.length} found\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        
        for (const peer of peers) {
          const ago = Math.floor((Date.now() - peer.lastSeen) / 1000);
          message += `\n   📡 ${peer.name}\n`;
          message += `      Host: ${peer.host}\n`;
          message += `      Port: ${peer.port}\n`;
          message += `      Last seen: ${ago}s ago\n`;
        }
      }
      
      message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      
      return {
        ok: true,
        message,
        localNode,
        peers,
        timestamp: now,
      };
    },
  };
}
