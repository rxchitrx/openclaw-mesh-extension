import type { SyncStateService } from "../sync-state.js";
export type TrackStateReader = () => {
    currentTrackDir: string | null;
};
export declare function ensureTrackedDirectory(syncState: SyncStateService, getTrackState: TrackStateReader): {
    ok: true;
    currentTrackDir: string;
    clearedStalePendingChanges?: undefined;
    stalePendingFiles?: undefined;
} | {
    ok: false;
    clearedStalePendingChanges: number;
    stalePendingFiles: string[];
    currentTrackDir?: undefined;
};
export declare function noTrackedDirectoryResponse(guard: ReturnType<typeof ensureTrackedDirectory>): {
    content: {
        type: "text";
        text: string;
    }[];
    details: {
        ok: boolean;
        error: string;
        clearedStalePendingChanges: number;
        stalePendingFiles: string[];
    };
};
