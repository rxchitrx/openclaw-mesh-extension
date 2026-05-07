import type { SyncStateService } from "../sync-state.js";
import type { TransportService } from "../transport.js";
import type { TrackedFile } from "../file-watcher.js";
export type BroadcastServices = {
    syncState: SyncStateService;
    transport: TransportService;
    getFileContent: (relativePath: string) => Promise<{
        content: string;
        isBinary: boolean;
    } | null>;
    getLocalManifest: () => TrackedFile[];
    nodeName: string;
};
export declare function createMeshBroadcastTool(services: BroadcastServices, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            file: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        file?: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            filesSent?: undefined;
            files?: undefined;
            peerCount?: undefined;
            timestamp?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            filesSent: number;
            error?: undefined;
            files?: undefined;
            peerCount?: undefined;
            timestamp?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            filesSent: number;
            files: string[];
            peerCount: number;
            timestamp: string;
            error?: undefined;
        };
    }>;
};
