import type { DiscoveryService } from "../discovery.js";
import type { TransportService } from "../transport.js";
import type { CRDTService } from "../crdt.js";
import type { FileWatcherService } from "../file-watcher.js";
type MeshServices = {
    discovery: DiscoveryService;
    transport: TransportService;
    crdt: CRDTService;
    fileWatcher: FileWatcherService | null;
    currentTrackDir: string | null;
};
export declare function createMeshStatusTool(services: MeshServices, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {};
        required: string[];
    };
    execute: (_toolCallId: string, _toolParams: any, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            status: {
                localNode: {
                    name: string;
                    host: string;
                    port: number;
                };
                trackDir: string;
                peerCount: number;
                connectionCount: number;
                syncedFiles: number;
                watchedFiles: number;
                pendingDeltas: number;
                health: string;
                timestamp: string;
            };
        };
    }>;
};
export {};
