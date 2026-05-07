export type MeshEventKind = "peer_discovered" | "peer_pending_approval" | "peer_approved" | "peer_denied" | "peer_connected" | "peer_disconnected" | "manifest_received" | "sync_requested" | "file_sent" | "file_received" | "file_written" | "sync_applied" | "sync_failed" | "conflict" | "discovery_warning";
export type MeshEventRecord = {
    id: string;
    kind: MeshEventKind;
    peerName?: string;
    filePath?: string;
    createdAt: number;
    message: string;
    details?: Record<string, unknown>;
    delivered: boolean;
    acknowledged: boolean;
    expiresAt?: number;
    lastDeliveredAt?: number;
    lastAcknowledgedAt?: number;
    lastSurfacedAt?: number;
    occurrences: number;
};
export type MeshEventInput = {
    kind: MeshEventKind;
    message: string;
    peerName?: string;
    filePath?: string;
    details?: Record<string, unknown>;
    expiresAt?: number;
};
export type MeshEventStore = {
    addEvent: (input: MeshEventInput) => MeshEventRecord;
    acknowledge: (eventId?: string) => {
        acknowledged: number;
        all: boolean;
    };
    markDelivered: (eventIds: string[], timestamp: number) => void;
    getUnreadCount: () => number;
    getUnacknowledged: () => MeshEventRecord[];
    getDeliverable: (timestamp: number) => MeshEventRecord[];
    listRecent: (limit?: number) => MeshEventRecord[];
    listUnread: () => MeshEventRecord[];
    getStats: () => {
        unreadCount: number;
        undeliveredCount: number;
        lastDeliveredAt: number | null;
        lastAcknowledgedAt: number | null;
    };
};
export declare function summarizeMeshEvents(events: MeshEventRecord[]): string;
export declare function createMeshEventStore(): MeshEventStore;
