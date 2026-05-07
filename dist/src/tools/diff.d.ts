import type { TransportService } from "../transport.js";
import type { SyncStateService } from "../sync-state.js";
import type { TrackedFile } from "../file-watcher.js";
export type DiffServices = {
    transport: TransportService;
    syncState: SyncStateService;
    getLocalManifest: () => TrackedFile[];
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
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        peerName?: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peersWithManifests?: undefined;
            peerName?: undefined;
            localOnly?: undefined;
            remoteOnly?: undefined;
            modified?: undefined;
            conflicted?: undefined;
            inSyncCount?: undefined;
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
            localOnly?: undefined;
            remoteOnly?: undefined;
            modified?: undefined;
            conflicted?: undefined;
            inSyncCount?: undefined;
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
            error?: undefined;
            peersWithManifests?: undefined;
        };
    }>;
};
