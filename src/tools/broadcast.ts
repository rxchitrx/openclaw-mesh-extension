import type { SyncStateService } from "../sync-state.js";
import type { TransportService } from "../transport.js";
import type { TrackedFile } from "../file-watcher.js";

export type BroadcastServices = {
  syncState: SyncStateService;
  transport: TransportService;
  getFileContent: (relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>;
  getLocalManifest: () => TrackedFile[];
};

export function createMeshBroadcastTool(services: BroadcastServices, _ctx: any) {
  return {
    label: "Mesh Broadcast",
    name: "mesh_broadcast",
    description: "Push local file changes to all connected mesh peers. Say 'broadcast' for all changed files, or 'broadcast index.ts' for a specific file.",
    parameters: {
      type: "object" as const,
      properties: {
        file: {
          type: "string",
          description: "Specific file to broadcast (optional, broadcasts all pending changes if not specified)",
        },
      },
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { file?: string }, _signal: any, _onUpdate: any) => {
      const { syncState, transport, getFileContent } = services;
      const file = toolParams?.file;
      const connections = transport.getConnections();

      if (connections.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No approved peers connected. Approve a peer connection first." }],
          details: { ok: false, error: "no_peers" },
        };
      }

      const pendingChanges = syncState.getPendingChanges();

      if (pendingChanges.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Nothing to broadcast — no local file changes detected." }],
          details: { ok: true, filesSent: 0 },
        };
      }

      const toBroadcast = file
        ? pendingChanges.filter((c) => c.relativePath === file)
        : pendingChanges;

      if (toBroadcast.length === 0 && file) {
        return {
          content: [{ type: "text" as const, text: `No pending changes for file: ${file}` }],
          details: { ok: true, filesSent: 0 },
        };
      }

      let sentCount = 0;
      const sentFiles: string[] = [];

      for (const change of toBroadcast) {
        const fileData = await getFileContent(change.relativePath);
        if (fileData) {
          for (const peerName of connections) {
            transport.sendFileContent(peerName, change.relativePath, fileData.content, fileData.isBinary);
            sentCount++;
          }
          sentFiles.push(change.relativePath);
        }
      }

      const fileList = [...new Set(sentFiles)];
      const now = new Date().toISOString();
      let message = `MESH BROADCAST\n`;
      message += `Timestamp: ${now}\n`;
      message += `Peers: ${connections.length}\n`;
      message += `Files queued: ${fileList.length}\n`;
      message += `Transfers sent: ${sentCount}\n`;
      message += `Pending changes clear after peers confirm file_applied.\n\n`;

      for (const f of fileList) {
        const change = toBroadcast.find((c) => c.relativePath === f);
        message += `  ${f} ${change?.isBinary ? "[binary]" : "[text]"}\n`;
      }

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          transfersSent: sentCount,
          files: fileList,
          peerCount: connections.length,
          timestamp: now,
        },
      };
    },
  };
}
