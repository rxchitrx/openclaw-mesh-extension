import type { DiscoveryService } from "../discovery.js";
import type { TransportService } from "../transport.js";
import type { SyncStateService } from "../sync-state.js";
import type { FileWatcherService } from "../file-watcher.js";
import type { MeshEventStore } from "../events.js";
import type { CapabilityRegistry } from "../capability-registry.js";
type TrackState = {
    fileWatcher: FileWatcherService | null;
    currentTrackDir: string | null;
    startFileWatcher: (dir: string) => Promise<void>;
    stopFileWatcher: () => Promise<void>;
};
type MeshServices = {
    discovery: DiscoveryService;
    transport: TransportService;
    syncState: SyncStateService;
    getTrackState: () => TrackState;
    capabilityRegistry?: CapabilityRegistry;
    eventStore?: MeshEventStore;
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
                localCapabilities: string[];
                trackDir: string;
                peerCount: number;
                connectionCount: number;
                pendingApprovalCount: number;
                unreadEventCount: number;
                undeliveredEventCount: number;
                lastDeliveredEventAt: number;
                lastAcknowledgedEventAt: number;
                watchedFiles: number;
                pendingChanges: number;
                inFlightSends: number;
                health: string;
                timestamp: string;
            };
        };
    }>;
};
export {};
