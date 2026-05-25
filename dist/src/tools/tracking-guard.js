export function ensureTrackedDirectory(syncState, getTrackState) {
    const currentTrackDir = getTrackState().currentTrackDir;
    if (currentTrackDir) {
        return { ok: true, currentTrackDir };
    }
    const stalePendingChanges = syncState.getPendingChanges();
    if (stalePendingChanges.length > 0) {
        syncState.clearPendingChanges();
    }
    return {
        ok: false,
        clearedStalePendingChanges: stalePendingChanges.length,
        stalePendingFiles: stalePendingChanges.map((change) => change.relativePath),
    };
}
export function noTrackedDirectoryResponse(guard) {
    const cleared = guard.ok ? 0 : guard.clearedStalePendingChanges;
    const resetText = cleared > 0
        ? ` Cleared ${cleared} stale pending file change(s) locally; nothing was sent to peers.`
        : "";
    return {
        content: [{
                type: "text",
                text: `No tracked directory is configured. Track a project directory before using file sync, diff, or broadcast actions.${resetText}`,
            }],
        details: {
            ok: false,
            error: "no_tracked_directory",
            clearedStalePendingChanges: cleared,
            stalePendingFiles: guard.ok ? [] : guard.stalePendingFiles,
        },
    };
}
