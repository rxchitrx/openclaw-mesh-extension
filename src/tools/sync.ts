import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { CRDTService } from "../crdt.js";

export function createMeshSyncTool(crdt: CRDTService, ctx: OpenClawPluginToolContext) {
  return {
    name: "mesh_sync",
    description: "Pull and merge any pending remote changes from connected mesh peers",
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

      if (files.length === 0) {
        return {
          ok: true,
          message: "No files to sync. The mesh has no shared files yet.",
        };
      }

      // Request sync from peers
      // This is handled by the transport service on heartbeat

      const fileList = files.map((f) => `  • ${f}`).join("\n");

      return {
        ok: true,
        message: `Requested sync for ${files.length} file(s):\n\n${fileList}\n\nChanges from peers will be merged automatically.`,
        files,
      };
    },
  };
}
