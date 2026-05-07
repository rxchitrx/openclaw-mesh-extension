export function createSyncState(config) {
    const { nodeName, logger } = config;
    const fileVersions = new Map();
    const lastSyncedHashes = new Map();
    const pendingChanges = [];
    const forceAllowSet = new Set();
    return {
        recordLocalChange(relativePath, hash, isBinary) {
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
            const change = { relativePath, hash, isBinary, timestamp: Date.now() };
            if (pendingIdx >= 0) {
                pendingChanges[pendingIdx] = change;
            }
            else {
                pendingChanges.push(change);
            }
            logger.info(`Sync state: local change ${relativePath} v${version} (${hash.slice(0, 8)})`);
        },
        recordRemoteChange(relativePath, hash, fromPeer, isBinary) {
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
        recordSyncedHash(relativePath, hash) {
            lastSyncedHashes.set(relativePath, hash);
        },
        getVersion(relativePath) {
            return fileVersions.get(relativePath) || null;
        },
        getLocalHash(relativePath) {
            return fileVersions.get(relativePath)?.hash || null;
        },
        getLastSyncedHash(relativePath) {
            return lastSyncedHashes.get(relativePath) || null;
        },
        isLocallyModified(relativePath) {
            const current = fileVersions.get(relativePath);
            if (!current)
                return false;
            const lastSynced = lastSyncedHashes.get(relativePath);
            if (!lastSynced)
                return true;
            return current.hash !== lastSynced;
        },
        isConflict(relativePath, remoteHash) {
            if (!this.isLocallyModified(relativePath))
                return false;
            const localHash = this.getLocalHash(relativePath);
            return localHash !== remoteHash;
        },
        getFileVersions() {
            return new Map(fileVersions);
        },
        getPendingChanges() {
            return [...pendingChanges];
        },
        getPendingChangesForFile(relativePath) {
            return pendingChanges.filter((c) => c.relativePath === relativePath);
        },
        clearPendingChanges(relativePaths) {
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
        removeFile(relativePath) {
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
        markForceAllow(relativePath) {
            forceAllowSet.add(relativePath);
        },
        consumeForceAllow(relativePath) {
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
