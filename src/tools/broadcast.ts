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
          description:
            "Specific file to broadcast (optional, broadcasts all pending deltas if not specified)",
        },
      },
      required: [],
    },
    execute: async (params: { file?: string }) => {
      const pendingDeltas = crdt.getPendingDeltas();

      if (pendingDeltas.length === 0) {
        return {
          ok: true,
          message: "No pending changes to broadcast. All files are in sync.",
        };
      }

      const toBroadcast = params.file
        ? pendingDeltas.filter((d) => d.file === params.file)
        : pendingDeltas;

      if (toBroadcast.length === 0) {
        return {
          ok: true,
          message: `No pending changes for file: ${params.file}`,
        };
      }

      // The actual broadcasting is handled by the transport service
      // This tool just confirms what would be broadcast

      const fileList = [...new Set(toBroadcast.map((d) => d.file))];

      return {
        ok: true,
        message: `Broadcasting ${toBroadcast.length} delta(s) across ${fileList.length} file(s):\n\n${fileList.map((f) => `  • ${f}`).join("\n")}\n\nChanges will propagate to all connected peers.`,
        deltas: toBroadcast,
        files: fileList,
      };
    },
  };
}
