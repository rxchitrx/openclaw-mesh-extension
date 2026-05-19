export type SyncStateConfig = {
    nodeName: string;
    logger: any;
    baseDir?: string;
};
export type FileVersion = {
    relativePath: string;
    hash: string;
    version: number;
    lastModifiedBy: string;
    lastModifiedAt: number;
    isBinary: boolean;
};
export type PendingChange = {
    relativePath: string;
    hash: string;
    isBinary: boolean;
    timestamp: number;
};
export type SyncStateService = {
    recordLocalChange: (relativePath: string, hash: string, isBinary: boolean) => void;
    recordRemoteChange: (relativePath: string, hash: string, fromPeer: string, isBinary: boolean) => void;
    recordSyncedHash: (relativePath: string, hash: string) => void;
    getVersion: (relativePath: string) => FileVersion | null;
    getLocalHash: (relativePath: string) => string | null;
    getLastSyncedHash: (relativePath: string) => string | null;
    isLocallyModified: (relativePath: string) => boolean;
    isConflict: (relativePath: string, remoteHash: string) => boolean;
    getFileVersions: () => Map<string, FileVersion>;
    getPendingChanges: () => PendingChange[];
    getPendingChangesForFile: (relativePath: string) => PendingChange[];
    clearPendingChanges: (relativePaths?: string[]) => void;
    removeFile: (relativePath: string) => void;
    getFiles: () => string[];
    markForceAllow: (relativePath: string) => void;
    consumeForceAllow: (relativePath: string) => boolean;
    markAllSynced: () => void;
};
export declare function createSyncState(config: SyncStateConfig): SyncStateService;
