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
    /** Records the hash of what we last successfully sent to a specific peer for a file. */
    recordSentToPeer: (peerName: string, relativePath: string, hash: string) => void;
    /** Returns the hash of what we last sent to a specific peer for a file, or null if never sent. */
    getLastSentHashToPeer: (peerName: string, relativePath: string) => string | null;
    /** Returns all hashes that are currently referenced by any peer-sent record (for shadow pruning). */
    getAllSentHashes: () => Set<string>;
};
export declare function createSyncState(config: SyncStateConfig): SyncStateService;
