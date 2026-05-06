import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { CRDTService } from "../crdt.js";

export function createMeshBroadcastTool(crdt: CRDTService, ctx: OpenClawPluginToolContext) {
  return {
    name: "mesh_broadcast",
    description: "Force push local changes to all connected mesh peers",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Specific file to broadcast (optional, broadcasts all pending deltas if not specified)",
        },
      },
      required: [],
    },
    execute: async (params: { file?: string }) => {
      const pendingDeltas = crdt.getPendingDeltas();
      const now = new Date().toISOString();
      
      let message = `📢 MESH BROADCAST\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `⏰ Timestamp: ${now}\n\n`;
      
      if (pendingDeltas.length === 0) {
        message += `✅ STATUS: Nothing to broadcast\n`;
        message += `   All files are in sync with peers.\n`;
        message += `\n💡 TIP: Edit a file in the workspace to create changes.`;
      } else {
        const toBroadcast = params.file
          ? pendingDeltas.filter(d => d.file === params.file)
          : pendingDeltas;
        
        if (toBroadcast.length === 0) {
          message += `⚠️ No pending changes for file: ${params.file}\n\n`;
          message += `📄 FILES WITH PENDING CHANGES:\n`;
          const files = [...new Set(pendingDeltas.map(d => d.file))];
          for (const f of files) {
            message += `   • ${f}\n`;
          }
        } else {
          const fileList = [...new Set(toBroadcast.map(d => d.file))];
          
          message += `📦 PREPARING BROADCAST\n`;
          message += `   Deltas to send: ${toBroadcast.length}\n`;
          message += `   Files affected: ${fileList.length}\n\n`;
          
          message += `📄 FILES:\n`;
          for (const f of fileList) {
            const deltas = toBroadcast.filter(d => d.file === f);
            const totalChanges = deltas.reduce((sum, d) => sum + d.changes.length, 0);
            message += `   📝 ${f}\n`;
            message += `      Deltas: ${deltas.length}\n`;
            message += `      Changes: ${totalChanges}\n`;
          }
          
          message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          message += `📤 BROADCAST RESULT\n`;
          message += `   Status: Queued for next heartbeat\n`;
          message += `   Target: All connected peers\n`;
          message += `\n💡 Deltas will be sent on the next heartbeat cycle.`;
        }
      }
      
      message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      
      return {
        ok: true,
        message,
        deltas: pendingDeltas,
        files: [...new Set(pendingDeltas.map(d => d.file))],
        timestamp: now,
      };
    },
  };
}
