export type SyncStateConfig = {
  nodeName: string;
  logger: any;
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

export function createSyncState(config: SyncStateConfig): SyncStateService {
  const { nodeName, logger } = config;

  const fileVersions = new Map<string, FileVersion>();
  const lastSyncedHashes = new Map<string, string>();
  const pendingChanges: PendingChange[] = [];
  const forceAllowSet = new Set<string>();

  return {
    recordLocalChange(relativePath: string, hash: string, isBinary: boolean) {
      const existing = fileVersions.get(relativePath);
      const version = existing ? existing.version + 1 : 1;

      fileVersions.set(relativePath, {
        relativePath,
        hash,
        version,
        lastModifiedBy: nodeName,
        lastModifiedAt: Date.now(),
        isBinary,
      });

      const pendingIdx = pendingChanges.findIndex((c) => c.relativePath === relativePath);
      const change: PendingChange = { relativePath, hash, isBinary, timestamp: Date.now() };
      if (pendingIdx >= 0) {
        pendingChanges[pendingIdx] = change;
      } else {
        pendingChanges.push(change);
      }

      logger.info(`Sync state: local change ${relativePath} v${version} (${hash.slice(0, 8)})`);
    },

    recordRemoteChange(relativePath: string, hash: string, fromPeer: string, isBinary: boolean) {
      const existing = fileVersions.get(relativePath);
      const version = existing ? existing.version + 1 : 1;

      fileVersions.set(relativePath, {
        relativePath,
        hash,
        version,
        lastModifiedBy: fromPeer,
        lastModifiedAt: Date.now(),
        isBinary,
      });

      lastSyncedHashes.set(relativePath, hash);
      logger.info(`Sync state: remote change ${relativePath} v${version} from ${fromPeer} (${hash.slice(0, 8)})`);
    },

    recordSyncedHash(relativePath: string, hash: string) {
      lastSyncedHashes.set(relativePath, hash);
    },

    getVersion(relativePath: string) {
      return fileVersions.get(relativePath) || null;
    },

    getLocalHash(relativePath: string) {
      return fileVersions.get(relativePath)?.hash || null;
    },

    getLastSyncedHash(relativePath: string) {
      return lastSyncedHashes.get(relativePath) || null;
    },

    isLocallyModified(relativePath: string) {
      const current = fileVersions.get(relativePath);
      if (!current) return false;
      const lastSynced = lastSyncedHashes.get(relativePath);
      if (!lastSynced) return true;
      return current.hash !== lastSynced;
    },

    isConflict(relativePath: string, remoteHash: string) {
      if (!this.isLocallyModified(relativePath)) return false;
      const localHash = this.getLocalHash(relativePath);
      return localHash !== remoteHash;
    },

    getFileVersions() {
      return new Map(fileVersions);
    },

    getPendingChanges() {
      return [...pendingChanges];
    },

    getPendingChangesForFile(relativePath: string) {
      return pendingChanges.filter((c) => c.relativePath === relativePath);
    },

    clearPendingChanges(relativePaths?: string[]) {
      if (!relativePaths) {
        pendingChanges.length = 0;
        return;
      }
      const set = new Set(relativePaths);
      for (let i = pendingChanges.length - 1; i >= 0; i--) {
        if (set.has(pendingChanges[i].relativePath)) {
          pendingChanges.splice(i, 1);
        }
      }
    },

    removeFile(relativePath: string) {
      fileVersions.delete(relativePath);
      lastSyncedHashes.delete(relativePath);
      for (let i = pendingChanges.length - 1; i >= 0; i--) {
        if (pendingChanges[i].relativePath === relativePath) {
          pendingChanges.splice(i, 1);
        }
      }
    },

    getFiles() {
      return Array.from(fileVersions.keys());
    },

    markForceAllow(relativePath: string) {
      forceAllowSet.add(relativePath);
    },

    consumeForceAllow(relativePath: string) {
      return forceAllowSet.delete(relativePath);
    },

    markAllSynced() {
      for (const [relativePath, version] of fileVersions) {
        lastSyncedHashes.set(relativePath, version.hash);
      }
      logger.info(`Marked ${fileVersions.size} file(s) as synced`);
    },
  };
}
