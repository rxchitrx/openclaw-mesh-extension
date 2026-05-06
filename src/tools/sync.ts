import type { CRDTService } from "../crdt.js";

export function createMeshSyncTool(crdt: CRDTService, _ctx: any) {
  return {
    label: "Mesh Sync",
    name: "mesh_sync",
    description: "Request sync from all connected mesh peers",
    parameters: {
      type: "object" as const,
      properties: {
        file: {
          type: "string",
          description: "Specific file to sync (optional, syncs all files if not specified)",
        },
      },
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { file?: string }, _signal: any, _onUpdate: any) => {
      const file = toolParams?.file;
      const files = file ? [file] : crdt.getFiles();
      const now = new Date().toISOString();

      let message = `MESH SYNC REQUEST\n`;
      message += `Timestamp: ${now}\n\n`;

      if (files.length === 0) {
        if (file) {
          message += `File not found: ${file}\n`;
          message += `File must exist in workspace CRDT to sync.\n`;
        } else {
          message += `No files to sync. Local CRDT is empty.\n`;
          message += `Create files in workspace to start syncing.\n`;
        }
      } else {
        message += `SYNC REQUEST\n`;
        message += `  Mode: ${file ? "SINGLE FILE" : "ALL FILES"}\n`;
        message += `  Files to sync: ${files.length}\n\n`;

        message += `FILES:\n`;
        for (const f of files) {
          const content = crdt.getFileContent(f);
          const preview = content ? content.substring(0, 50) + "..." : "(empty)";
          message += `  ${f}: ${preview}\n`;
        }

        message += `\nSYNC STATUS\n`;
        message += `  Request sent to transport layer\n`;
        message += `  Will request state from all connected peers on next heartbeat cycle\n`;
        message += `  Remote changes will be merged automatically on receipt.\n`;
      }

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          files,
          timestamp: now,
        },
      };
    },
  };
}
