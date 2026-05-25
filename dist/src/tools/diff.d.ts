import type { TransportService } from "../transport.js";
import type { SyncStateService } from "../sync-state.js";
import type { TrackedFile } from "../file-watcher.js";
import { type DiffPreview } from "../diff-engine.js";
import { type TrackStateReader } from "./tracking-guard.js";
export type DiffServices = {
    transport: TransportService;
    syncState: SyncStateService;
    getLocalManifest: () => TrackedFile[];
    getFileContent: (relativePath: string) => Promise<{
        content: string;
        isBinary: boolean;
    } | null>;
    getTrackState: TrackStateReader;
};
export declare function createMeshDiffTool(services: DiffServices, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            peerName: {
                type: string;
                description: string;
            };
            file: {
                type: string;
                description: string;
            };
            includePatch: {
                type: string;
                description: string;
            };
            contextLines: {
                type: string;
                description: string;
            };
            maxBytes: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        peerName?: string;
        file?: string;
        includePatch?: boolean;
        contextLines?: number;
        maxBytes?: number;
    }, _signal: any, _onUpdate: any) => Promise<{
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
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peersWithManifests?: undefined;
            peerName?: undefined;
            file?: undefined;
            localOnly?: undefined;
            remoteOnly?: undefined;
            modified?: undefined;
            conflicted?: undefined;
            inSyncCount?: undefined;
            previews?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            peersWithManifests: string[];
            error?: undefined;
            peerName?: undefined;
            file?: undefined;
            localOnly?: undefined;
            remoteOnly?: undefined;
            modified?: undefined;
            conflicted?: undefined;
            inSyncCount?: undefined;
            previews?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peerName: string;
            file: string;
            peersWithManifests?: undefined;
            localOnly?: undefined;
            remoteOnly?: undefined;
            modified?: undefined;
            conflicted?: undefined;
            inSyncCount?: undefined;
            previews?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            peerName: string;
            localOnly: string[];
            remoteOnly: string[];
            modified: string[];
            conflicted: string[];
            inSyncCount: number;
            previews: DiffPreview[];
            error?: undefined;
            peersWithManifests?: undefined;
            file?: undefined;
        };
    }>;
};
