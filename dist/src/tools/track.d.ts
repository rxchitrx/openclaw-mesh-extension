import type { FileWatcherService } from "../file-watcher.js";
type TrackState = {
    fileWatcher: FileWatcherService | null;
    currentTrackDir: string | null;
    startFileWatcher: (dir: string) => Promise<void>;
    stopFileWatcher: () => Promise<void>;
};
export declare function createMeshTrackTool(getTrackState: () => TrackState, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            path: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        path?: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            currentTrackDir: string;
            watchedFiles: number;
            action?: undefined;
            previousDir?: undefined;
            trackDir?: undefined;
            error?: undefined;
            path?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            currentTrackDir: any;
            watchedFiles?: undefined;
            action?: undefined;
            previousDir?: undefined;
            trackDir?: undefined;
            error?: undefined;
            path?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            previousDir: string;
            currentTrackDir?: undefined;
            watchedFiles?: undefined;
            trackDir?: undefined;
            error?: undefined;
            path?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            trackDir: string;
            watchedFiles: number;
            currentTrackDir?: undefined;
            previousDir?: undefined;
            error?: undefined;
            path?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: any;
            path: string;
            currentTrackDir?: undefined;
            watchedFiles?: undefined;
            action?: undefined;
            previousDir?: undefined;
            trackDir?: undefined;
        };
    }>;
};
export {};
