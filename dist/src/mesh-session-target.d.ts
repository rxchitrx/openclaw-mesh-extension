export declare const DEFAULT_NOTIFICATION_SESSION_TTL_MS: number;
export type MeshSessionTarget = {
    sessionKey: string;
    updatedAt: number;
    source: string;
    deliveryContext?: unknown;
};
export type MeshSessionTargetStore = {
    remember: (sessionKey: string, source: string, deliveryContext?: unknown) => MeshSessionTarget | null;
    getCurrent: () => MeshSessionTarget | null;
};
export type MeshSessionTargetStoreOptions = {
    baseDir?: string;
    ttlMs?: number;
    now?: () => number;
    logger?: {
        warn?: (message: string) => void;
        debug?: (message: string) => void;
    };
};
export declare function createMeshSessionTargetStore(options?: MeshSessionTargetStoreOptions): MeshSessionTargetStore;
