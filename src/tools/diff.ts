import type { TransportService } from "../transport.js";
import type { SyncStateService } from "../sync-state.js";
import type { TrackedFile } from "../file-watcher.js";
import { createDiffPreview, type DiffPreview } from "../diff-engine.js";
import { ensureTrackedDirectory, noTrackedDirectoryResponse, type TrackStateReader } from "./tracking-guard.js";

export type DiffServices = {
  transport: TransportService;
  syncState: SyncStateService;
  getLocalManifest: () => TrackedFile[];
  getFileContent: (relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>;
  getTrackState: TrackStateReader;
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
        file: {
          type: "string",
          description: "Optional single file path to diff.",
        },
        includePatch: {
          type: "boolean",
          description: "Include unified text patches for changed text files. Defaults to true.",
        },
        contextLines: {
          type: "number",
          description: "Number of context lines in unified diffs. Defaults to 3.",
        },
        maxBytes: {
          type: "number",
          description: "Maximum combined text bytes to preview per file. Defaults to 200000.",
        },
      },
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { peerName?: string; file?: string; includePatch?: boolean; contextLines?: number; maxBytes?: number }, _signal: any, _onUpdate: any) => {
      const { transport, syncState, getLocalManifest, getFileContent } = services;
      const peerName = toolParams?.peerName;
      const includePatch = toolParams?.includePatch !== false;
      const requestedFile = toolParams?.file;
      const contextLines = Math.max(0, Math.min(toolParams?.contextLines ?? 3, 20));
      const maxBytes = Math.max(1024, toolParams?.maxBytes ?? 200000);
      const connections = transport.getConnections();
      const trackGuard = ensureTrackedDirectory(syncState, services.getTrackState);
      if (!trackGuard.ok) {
        return noTrackedDirectoryResponse(trackGuard);
      }

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
            const localManifest = getLocalManifest();
            const localMap = new Map(localManifest.map((f) => [f.relativePath, f]));
            const remoteMap = new Map(manifest.map((f) => [f.relativePath, f]));
            const localOnly = localManifest.filter((f) => !remoteMap.has(f.relativePath)).length;
            const remoteOnly = manifest.filter((f) => !localMap.has(f.relativePath)).length;
            const changed = localManifest.filter((f) => {
              const remote = remoteMap.get(f.relativePath);
              return remote && remote.hash !== f.hash;
            }).length;
            message += ` | delta: ${localOnly} local-only / ${remoteOnly} remote-only / ${changed} changed`;
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

      const shouldInclude = (filePath: string) => !requestedFile || requestedFile === filePath;

      for (const [filePath, file] of localMap) {
        if (!shouldInclude(filePath)) continue;
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
        if (!shouldInclude(filePath)) continue;
        if (!localMap.has(filePath)) {
          remoteOnly.push(file);
        }
      }

      const info = transport.getNodeInfo(peerName);
      let message = `DIFF: local vs ${peerName}\n\n`;
      if (info) {
        message += `REMOTE NODE\n`;
        message += `  Tracking: ${info.trackingDir || "not tracking"}\n`;
        message += `  Files: ${info.trackingFileCount}\n\n`;
      }
      if (requestedFile && !localMap.has(requestedFile) && !remoteMap.has(requestedFile)) {
        return {
          content: [{ type: "text" as const, text: `No local or remote file named '${requestedFile}' found for '${peerName}'.` }],
          details: { ok: false, error: "file_not_found", peerName, file: requestedFile },
        };
      }

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

      const filesNeedingPreview = [...localOnly, ...remoteOnly, ...modified, ...conflicted];
      const previews: DiffPreview[] = [];
      if (includePatch && filesNeedingPreview.length > 0) {
        message += `\nPATCH PREVIEW\n`;
        for (const item of filesNeedingPreview.slice(0, 20)) {
          const localFile = localMap.get(item.relativePath);
          const remoteFile = remoteMap.get(item.relativePath);
          const localContent = localFile ? await getFileContent(item.relativePath) : null;
          const remoteContent = remoteFile ? await transport.requestFilePreview(peerName, item.relativePath, 5000) : null;
          const preview = createDiffPreview({
            path: item.relativePath,
            local: localFile && localContent ? { file: localFile, content: localContent.content } : localFile ? { file: localFile } : undefined,
            remote: remoteFile && remoteContent ? { file: remoteFile, content: remoteContent.content } : remoteFile ? { file: remoteFile } : undefined,
            contextLines,
            maxBytes,
          });
          previews.push(preview);
          message += `\n--- ${preview.path} (${preview.kind}) ---\n`;
          message += `${preview.summary}\n`;
          if (preview.patch) {
            message += `${preview.patch}\n`;
          }
        }
        if (filesNeedingPreview.length > 20) {
          message += `\nPreview limited to first 20 changed files. Use file=<path> to inspect one file.\n`;
        }
      }

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
          previews,
        },
      };
    },
  };
}
