import * as fs from "fs";
import * as os from "os";
import * as path from "path";
const DEFAULT_DIR = path.join(os.homedir(), ".openclaw", "mesh");
function statePath(baseDir) {
    return path.join(baseDir, "sync-state.json");
}
function peerSentHashesPath(baseDir) {
    return path.join(baseDir, "peer-sent-hashes.json");
}
function loadPeerSentHashes(baseDir) {
    try {
        const raw = JSON.parse(fs.readFileSync(peerSentHashesPath(baseDir), "utf-8"));
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            return {};
        // Validate shape: only keep well-formed entries
        const result = {};
        for (const [peer, files] of Object.entries(raw)) {
            if (typeof peer !== "string" || !files || typeof files !== "object" || Array.isArray(files))
                continue;
            result[peer] = {};
            for (const [filePath, hash] of Object.entries(files)) {
                if (typeof filePath === "string" && typeof hash === "string" && hash.length > 0) {
                    result[peer][filePath] = hash;
                }
            }
        }
        return result;
    }
    catch {
        return {};
    }
}
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
function parseFileVersion(value) {
    if (!value || typeof value !== "object")
        return null;
    const candidate = value;
    if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0)
        return null;
    if (typeof candidate.hash !== "string")
        return null;
    if (typeof candidate.version !== "number" || !Number.isFinite(candidate.version))
        return null;
    if (typeof candidate.lastModifiedBy !== "string")
        return null;
    if (typeof candidate.lastModifiedAt !== "number" || !Number.isFinite(candidate.lastModifiedAt))
        return null;
    if (typeof candidate.isBinary !== "boolean")
        return null;
    return {
        relativePath: candidate.relativePath,
        hash: candidate.hash,
        version: candidate.version,
        lastModifiedBy: candidate.lastModifiedBy,
        lastModifiedAt: candidate.lastModifiedAt,
        isBinary: candidate.isBinary,
    };
}
function parsePendingChange(value) {
    if (!value || typeof value !== "object")
        return null;
    const candidate = value;
    if (typeof candidate.relativePath !== "string" || candidate.relativePath.length === 0)
        return null;
    if (typeof candidate.hash !== "string")
        return null;
    if (typeof candidate.isBinary !== "boolean")
        return null;
    if (typeof candidate.timestamp !== "number" || !Number.isFinite(candidate.timestamp))
        return null;
    return {
        relativePath: candidate.relativePath,
        hash: candidate.hash,
        isBinary: candidate.isBinary,
        timestamp: candidate.timestamp,
    };
}
function loadPersistedSyncState(baseDir) {
    try {
        const parsed = JSON.parse(fs.readFileSync(statePath(baseDir), "utf-8"));
        if (!parsed || typeof parsed !== "object") {
            return { fileVersions: [], lastSyncedHashes: [], pendingChanges: [] };
        }
        const candidate = parsed;
        const fileVersions = Array.isArray(candidate.fileVersions)
            ? candidate.fileVersions.map(parseFileVersion).filter((item) => Boolean(item))
            : [];
        const lastSyncedHashes = Array.isArray(candidate.lastSyncedHashes)
            ? candidate.lastSyncedHashes.filter((item) => Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "string")
            : [];
        const pendingChanges = Array.isArray(candidate.pendingChanges)
            ? candidate.pendingChanges.map(parsePendingChange).filter((item) => Boolean(item))
            : [];
        return { fileVersions, lastSyncedHashes, pendingChanges };
    }
    catch {
        return { fileVersions: [], lastSyncedHashes: [], pendingChanges: [] };
    }
}
export function createSyncState(config) {
    const { nodeName, logger } = config;
    const baseDir = config.baseDir ?? DEFAULT_DIR;
    const fileVersions = new Map();
    const lastSyncedHashes = new Map();
    const pendingChanges = [];
    const forceAllowSet = new Set();
    // Per-peer sent hash tracking: peerName -> filePath -> hash
    // Persisted separately so it survives extension restarts.
    const peerSentHashes = loadPeerSentHashes(baseDir);
    const savePeerSentHashes = () => {
        try {
            ensureDir(baseDir);
            fs.writeFileSync(peerSentHashesPath(baseDir), JSON.stringify(peerSentHashes, null, 2), { mode: 0o600 });
        }
        catch (err) {
            logger.warn?.(`Could not persist peer-sent hashes: ${err}`);
        }
    };
    const persisted = loadPersistedSyncState(baseDir);
    for (const version of persisted.fileVersions) {
        fileVersions.set(version.relativePath, version);
    }
    for (const [relativePath, hash] of persisted.lastSyncedHashes) {
        lastSyncedHashes.set(relativePath, hash);
    }
    pendingChanges.push(...persisted.pendingChanges);
    const save = () => {
        try {
            ensureDir(baseDir);
            const payload = {
                fileVersions: Array.from(fileVersions.values()),
                lastSyncedHashes: Array.from(lastSyncedHashes.entries()),
                pendingChanges: [...pendingChanges],
            };
            fs.writeFileSync(statePath(baseDir), JSON.stringify(payload, null, 2), { mode: 0o600 });
        }
        catch (err) {
            logger.warn?.(`Could not persist mesh sync state: ${err}`);
        }
    };
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
            save();
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
            save();
        },
        recordSyncedHash(relativePath, hash) {
            lastSyncedHashes.set(relativePath, hash);
            save();
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
                save();
                return;
            }
            const set = new Set(relativePaths);
            for (let i = pendingChanges.length - 1; i >= 0; i--) {
                if (set.has(pendingChanges[i].relativePath)) {
                    pendingChanges.splice(i, 1);
                }
            }
            save();
        },
        removeFile(relativePath) {
            fileVersions.delete(relativePath);
            lastSyncedHashes.delete(relativePath);
            for (let i = pendingChanges.length - 1; i >= 0; i--) {
                if (pendingChanges[i].relativePath === relativePath) {
                    pendingChanges.splice(i, 1);
                }
            }
            save();
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
            save();
        },
        recordSentToPeer(peerName, relativePath, hash) {
            if (!peerSentHashes[peerName]) {
                peerSentHashes[peerName] = {};
            }
            peerSentHashes[peerName][relativePath] = hash;
            savePeerSentHashes();
        },
        getLastSentHashToPeer(peerName, relativePath) {
            return peerSentHashes[peerName]?.[relativePath] ?? null;
        },
        getAllSentHashes() {
            const hashes = new Set();
            for (const files of Object.values(peerSentHashes)) {
                for (const hash of Object.values(files)) {
                    hashes.add(hash);
                }
            }
            return hashes;
        },
    };
}
