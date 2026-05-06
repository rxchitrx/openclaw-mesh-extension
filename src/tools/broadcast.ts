import type { CRDTService } from "../crdt.js";

export function createMeshBroadcastTool(crdt: CRDTService, _ctx: any) {
  return {
    label: "Mesh Broadcast",
    name: "mesh_broadcast",
    description: "Force push local changes to all connected mesh peers",
    parameters: {
      type: "object" as const,
      properties: {
        file: {
          type: "string",
          description: "Specific file to broadcast (optional, broadcasts all pending deltas if not specified)",
        },
      },
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { file?: string }, _signal: any, _onUpdate: any) => {
      const pendingDeltas = crdt.getPendingDeltas();
      const now = new Date().toISOString();
      const file = toolParams?.file;

      let message = `MESH BROADCAST\n`;
      message += `Timestamp: ${now}\n\n`;

      if (pendingDeltas.length === 0) {
        message += `Nothing to broadcast. All files are in sync with peers.\n`;
        message += `Edit a file in the workspace to create changes.`;
      } else {
        const toBroadcast = file
          ? pendingDeltas.filter((d: any) => d.file === file)
          : pendingDeltas;

        if (toBroadcast.length === 0) {
          message += `No pending changes for file: ${file}\n\n`;
          message += `Files with pending changes:\n`;
          const files = [...new Set(pendingDeltas.map((d: any) => d.file))];
          for (const f of files) {
            message += `  ${f}\n`;
          }
        } else {
          const fileList = [...new Set(toBroadcast.map((d: any) => d.file))];

          message += `Preparing broadcast\n`;
          message += `  Deltas to send: ${toBroadcast.length}\n`;
          message += `  Files affected: ${fileList.length}\n\n`;

          message += `FILES:\n`;
          for (const f of fileList) {
            const deltas = toBroadcast.filter((d: any) => d.file === f);
            const totalChanges = deltas.reduce((sum: number, d: any) => sum + d.changes.length, 0);
            message += `  ${f} (${deltas.length} deltas, ${totalChanges} changes)\n`;
          }

          message += `\nBROADCAST RESULT\n`;
          message += `  Status: Queued for next heartbeat\n`;
          message += `  Target: All connected peers\n`;
        }
      }

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          deltas: pendingDeltas,
          files: [...new Set(pendingDeltas.map((d: any) => d.file))],
          timestamp: now,
        },
      };
    },
  };
}
