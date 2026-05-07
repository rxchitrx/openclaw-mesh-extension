import type { TransportService } from "../transport.js";
import type { SyncStateService } from "../sync-state.js";
import type { TrackedFile } from "../file-watcher.js";

export type DiffServices = {
  transport: TransportService;
  syncState: SyncStateService;
  getLocalManifest: () => TrackedFile[];
};

export function createMeshDiffTool(services: DiffServices, _ctx: any) {
  return {
    label: "Mesh Diff",
    name: "mesh_diff",
    description: "Compare local files against a remote peer's manifest. Shows which files are local-only, remote-only, modified, or conflicted.",
    parameters: {
      type: "object" as const,
      properties: {
        peerName: {
          type: "string",
          description: "Name of the peer to compare with. Omit to see all peers with manifests.",
        },
      },
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { peerName?: string }, _signal: any, _onUpdate: any) => {
      const { transport, syncState, getLocalManifest } = services;
      const peerName = toolParams?.peerName;
      const connections = transport.getConnections();

      if (connections.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No connected peers to compare with. Approve a peer connection first." }],
          details: { ok: false, error: "no_peers" },
        };
      }

      if (!peerName) {
        const peersWithManifests = connections.filter((name) => transport.getRemoteManifest(name) !== null);
        let message = `PEER MANIFESTS\n`;
        if (peersWithManifests.length === 0) {
          message += `No manifests received yet. Manifests are exchanged automatically after approval.\n`;
          message += `Connected peers: ${connections.join(", ")}`;
        } else {
          for (const name of peersWithManifests) {
            const manifest = transport.getRemoteManifest(name)!;
            const info = transport.getNodeInfo(name);
            message += `  ${name}`;
            if (info) {
              const dirStr = info.trackingDir || "not tracking";
              message += ` | tracking: ${dirStr} (${info.trackingFileCount} files)`;
            }
            message += ` | manifest: ${manifest.length} files`;
            message += `\n`;
          }
          message += `\nSay 'diff with <peerName>' to compare files.`;
        }
        return {
          content: [{ type: "text" as const, text: message }],
          details: { ok: true, peersWithManifests },
        };
      }

      const remoteManifest = transport.getRemoteManifest(peerName);
      if (!remoteManifest) {
        return {
          content: [{ type: "text" as const, text: `No manifest from '${peerName}'. Exchange manifests first with 'sync with ${peerName}'.` }],
          details: { ok: false, error: "no_manifest" },
        };
      }

      const localManifest = getLocalManifest();
      const localMap = new Map(localManifest.map((f) => [f.relativePath, f]));
      const remoteMap = new Map(remoteManifest.map((f) => [f.relativePath, f]));

      const localOnly: TrackedFile[] = [];
      const remoteOnly: TrackedFile[] = [];
      const modified: TrackedFile[] = [];
      const conflicted: TrackedFile[] = [];
      const inSync: TrackedFile[] = [];

      for (const [filePath, file] of localMap) {
        if (!remoteMap.has(filePath)) {
          localOnly.push(file);
        } else {
          const remote = remoteMap.get(filePath)!;
          if (file.hash !== remote.hash) {
            if (syncState.isLocallyModified(filePath)) {
              conflicted.push(file);
            } else {
              modified.push(file);
            }
          } else {
            inSync.push(file);
          }
        }
      }

      for (const [filePath, file] of remoteMap) {
        if (!localMap.has(filePath)) {
          remoteOnly.push(file);
        }
      }

      const info = transport.getNodeInfo(peerName);
      let message = `DIFF: local vs ${peerName}\n\n`;

      if (localOnly.length > 0) {
        message += `LOCAL ONLY (you have, they don't):\n`;
        for (const f of localOnly) {
          message += `  ${f.relativePath} ${f.isBinary ? "[binary]" : ""} (${f.size}b)\n`;
        }
        message += `\n`;
      }

      if (remoteOnly.length > 0) {
        message += `REMOTE ONLY (they have, you don't):\n`;
        for (const f of remoteOnly) {
          message += `  ${f.relativePath} ${f.isBinary ? "[binary]" : ""} (${f.size}b)\n`;
        }
        message += `\n`;
      }

      if (modified.length > 0) {
        message += `MODIFIED (remote has newer version, you haven't changed locally):\n`;
        for (const f of modified) {
          const remote = remoteMap.get(f.relativePath)!;
          message += `  ${f.relativePath} ${f.isBinary ? "[binary]" : ""} (local: ${f.size}b, remote: ${remote.size}b)\n`;
        }
        message += `\n`;
      }

      if (conflicted.length > 0) {
        message += `CONFLICT (both sides modified — pull will be blocked unless forced):\n`;
        for (const f of conflicted) {
          const remote = remoteMap.get(f.relativePath)!;
          message += `  ${f.relativePath} ${f.isBinary ? "[binary]" : ""} (local: ${f.size}b, remote: ${remote.size}b)\n`;
        }
        message += `\n`;
      }

      message += `IN SYNC: ${inSync.length} files\n\n`;
      message += `SUMMARY: ${localOnly.length} local-only | ${remoteOnly.length} remote-only | ${modified.length} modified | ${conflicted.length} conflicted | ${inSync.length} in sync\n`;

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          peerName,
          localOnly: localOnly.map((f) => f.relativePath),
          remoteOnly: remoteOnly.map((f) => f.relativePath),
          modified: modified.map((f) => f.relativePath),
          conflicted: conflicted.map((f) => f.relativePath),
          inSyncCount: inSync.length,
        },
      };
    },
  };
}
