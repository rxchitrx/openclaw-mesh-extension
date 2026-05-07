import type { SyncStateService } from "../sync-state.js";
import type { TransportService } from "../transport.js";
import type { TrackedFile } from "../file-watcher.js";
export type SyncServices = {
    syncState: SyncStateService;
    transport: TransportService;
    getFileContent: (relativePath: string) => Promise<{
        content: string;
        isBinary: boolean;
    } | null>;
    getLocalManifest: () => TrackedFile[];
};
export declare function createMeshSyncTool(services: SyncServices, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            action: {
                type: string;
                description: string;
            };
            peerName: {
                type: string;
                description: string;
            };
            file: {
                type: string;
                description: string;
            };
            force: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        action?: string;
        peerName?: string;
        file?: string;
        force?: boolean;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            action?: undefined;
            peerName?: undefined;
            localFileCount?: undefined;
            file?: undefined;
            forced?: undefined;
            filesSent?: undefined;
            files?: undefined;
            filesRequested?: undefined;
            conflicts?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            peerName: string;
            localFileCount: number;
            error?: undefined;
            file?: undefined;
            forced?: undefined;
            filesSent?: undefined;
            files?: undefined;
            filesRequested?: undefined;
            conflicts?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            peerName: string;
            file: string;
            error?: undefined;
            localFileCount?: undefined;
            forced?: undefined;
            filesSent?: undefined;
            files?: undefined;
            filesRequested?: undefined;
            conflicts?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            file: string;
            action?: undefined;
            peerName?: undefined;
            localFileCount?: undefined;
            forced?: undefined;
            filesSent?: undefined;
            files?: undefined;
            filesRequested?: undefined;
            conflicts?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            peerName: string;
            file: string;
            forced: boolean;
            error?: undefined;
            localFileCount?: undefined;
            filesSent?: undefined;
            files?: undefined;
            filesRequested?: undefined;
            conflicts?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            filesSent: number;
            error?: undefined;
            peerName?: undefined;
            localFileCount?: undefined;
            file?: undefined;
            forced?: undefined;
            files?: undefined;
            filesRequested?: undefined;
            conflicts?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            peerName: string;
            filesSent: number;
            files: string[];
            error?: undefined;
            localFileCount?: undefined;
            file?: undefined;
            forced?: undefined;
            filesRequested?: undefined;
            conflicts?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            filesRequested: number;
            error?: undefined;
            peerName?: undefined;
            localFileCount?: undefined;
            file?: undefined;
            forced?: undefined;
            filesSent?: undefined;
            files?: undefined;
            conflicts?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            peerName: string;
            filesRequested: number;
            conflicts: string[];
            files: string[];
            error?: undefined;
            localFileCount?: undefined;
            file?: undefined;
            forced?: undefined;
            filesSent?: undefined;
        };
    }>;
};
