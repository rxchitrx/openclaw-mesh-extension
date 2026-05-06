import type { FileWatcherService } from "../file-watcher.js";

type TrackState = {
  fileWatcher: FileWatcherService | null;
  currentTrackDir: string | null;
  startFileWatcher: (dir: string) => Promise<void>;
  stopFileWatcher: () => Promise<void>;
};

export function createMeshTrackTool(getTrackState: () => TrackState, _ctx: any) {
  return {
    label: "Mesh Track",
    name: "mesh_track",
    description: "Set or change which project directory to track and sync with mesh peers. Use this to start sharing a project folder. Say 'track /path/to/project' or 'stop tracking'.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the project directory to track. Omit to see current tracked directory, or set to 'stop' to stop tracking.",
        },
      },
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { path?: string }, _signal: any, _onUpdate: any) => {
      const { fileWatcher, currentTrackDir, startFileWatcher, stopFileWatcher } = getTrackState();
      const rawPath = toolParams?.path?.trim();

      if (!rawPath) {
        if (currentTrackDir) {
          const watched = fileWatcher?.getWatchedFiles()?.length ?? 0;
          return {
            content: [{ type: "text" as const, text: `Currently tracking: ${currentTrackDir} (${watched} files). Set a new path to switch, or say "stop tracking" to stop.` }],
            details: { ok: true, currentTrackDir, watchedFiles: watched },
          };
        }
        return {
          content: [{ type: "text" as const, text: "No directory is being tracked. Tell me a project path to start tracking, like 'track ~/my-project'." }],
          details: { ok: true, currentTrackDir: null },
        };
      }

      if (rawPath.toLowerCase() === "stop") {
        if (!fileWatcher) {
          return {
            content: [{ type: "text" as const, text: "Not tracking any directory right now." }],
            details: { ok: true, currentTrackDir: null },
          };
        }
        const prevDir = currentTrackDir;
        await stopFileWatcher();
        return {
          content: [{ type: "text" as const, text: `Stopped tracking: ${prevDir}` }],
          details: { ok: true, action: "stop", previousDir: prevDir },
        };
      }

      const path = await import("path");
      const fs = await import("fs");
      const resolved = path.resolve(rawPath.replace(/^~/, process.env.HOME || "~"));

      try {
        const stat = await fs.promises.stat(resolved);
        if (!stat.isDirectory()) {
          return {
            content: [{ type: "text" as const, text: `${resolved} is not a directory.` }],
            details: { ok: false, error: "not_a_directory", path: resolved },
          };
        }
      } catch {
        return {
          content: [{ type: "text" as const, text: `Directory doesn't exist: ${resolved}` }],
          details: { ok: false, error: "not_found", path: resolved },
        };
      }

      try {
        await startFileWatcher(resolved);
        const watched = getTrackState().fileWatcher?.getWatchedFiles()?.length ?? 0;
        return {
          content: [{ type: "text" as const, text: `Now tracking: ${resolved} (${watched} files found). Changes will be synced with connected mesh peers.` }],
          details: { ok: true, action: "start", trackDir: resolved, watchedFiles: watched },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to start tracking ${resolved}: ${err.message}` }],
          details: { ok: false, error: err.message, path: resolved },
        };
      }
    },
  };
}
