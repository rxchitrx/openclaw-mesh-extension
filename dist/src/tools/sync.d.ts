import type { CRDTService } from "../crdt.js";
import type { TransportService } from "../transport.js";
import type { TrackedFile } from "../file-watcher.js";
export type SyncServices = {
    crdt: CRDTService;
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
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        action?: string;
        peerName?: string;
        file?: string;
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
            filesSent?: undefined;
            filesRequested?: undefined;
            files?: undefined;
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
            filesSent?: undefined;
            filesRequested?: undefined;
            files?: undefined;
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
            filesSent?: undefined;
            filesRequested?: undefined;
            files?: undefined;
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
            filesRequested?: undefined;
            files?: undefined;
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
            error?: undefined;
            localFileCount?: undefined;
            file?: undefined;
            filesRequested?: undefined;
            files?: undefined;
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
            filesSent?: undefined;
            files?: undefined;
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
            files: string[];
            error?: undefined;
            localFileCount?: undefined;
            file?: undefined;
            filesSent?: undefined;
        };
    }>;
};
