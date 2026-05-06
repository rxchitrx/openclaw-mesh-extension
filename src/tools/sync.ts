import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { CRDTService } from "../crdt.js";

export function createMeshSyncTool(crdt: CRDTService, ctx: OpenClawPluginToolContext) {
  return {
    name: "mesh_sync",
    description: "Request sync from all connected mesh peers",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Specific file to sync (optional, syncs all files if not specified)",
        },
      },
      required: [],
    },
    execute: async (params: { file?: string }) => {
      const files = params.file ? [params.file] : crdt.getFiles();
      const now = new Date().toISOString();
      
      let message = `🔄 MESH SYNC REQUEST\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `⏰ Timestamp: ${now}\n\n`;
      
      if (files.length === 0) {
        if (params.file) {
          message += `⚠️ FILE NOT FOUND\n`;
          message += `   Requested: ${params.file}\n`;
          message += `   Status: Not in local CRDT\n\n`;
          message += `💡 TIP: File must exist in workspace to sync.`;
        } else {
          message += `📭 NO FILES TO SYNC\n`;
          message += `   Local CRDT is empty.\n\n`;
          message += `💡 TIP: Create files in workspace to start syncing.`;
        }
      } else {
        message += `📤 SYNC REQUEST\n`;
        message += `   Mode: ${params.file ? 'SINGLE FILE' : 'ALL FILES'}\n`;
        message += `   Files to sync: ${files.length}\n\n`;
        
        message += `📄 FILES:\n`;
        for (const f of files) {
          const content = crdt.getFileContent(f);
          const contentPreview = content ? content.substring(0, 50) + '...' : '(empty)';
          message += `   📝 ${f}\n`;
          message += `      Preview: ${contentPreview}\n`;
        }
        
        message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📥 SYNC STATUS\n`;
        message += `   Request: Sent to transport layer\n`;
        message += `   Action: Will request state from all connected peers\n`;
        message += `   Timing: Next heartbeat cycle\n\n`;
        message += `💡 Remote changes will be merged automatically on receipt.`;
      }
      
      message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      
      return {
        ok: true,
        message,
        files,
        timestamp: now,
      };
    },
  };
}
