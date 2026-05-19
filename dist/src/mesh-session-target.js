import * as fs from "fs";
import * as os from "os";
import * as path from "path";
export const DEFAULT_NOTIFICATION_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DIR = path.join(os.homedir(), ".openclaw", "mesh");
function targetPath(baseDir) {
    return path.join(baseDir, "active-session.json");
}
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
function parseTarget(value) {
    if (!value || typeof value !== "object")
        return null;
    const candidate = value;
    if (typeof candidate.sessionKey !== "string" || candidate.sessionKey.length === 0)
        return null;
    if (typeof candidate.updatedAt !== "number" || !Number.isFinite(candidate.updatedAt))
        return null;
    return {
        sessionKey: candidate.sessionKey,
        updatedAt: candidate.updatedAt,
        source: typeof candidate.source === "string" ? candidate.source : "unknown",
        deliveryContext: candidate.deliveryContext,
    };
}
function isFresh(target, now, ttlMs) {
    return now - target.updatedAt <= ttlMs;
}
export function createMeshSessionTargetStore(options = {}) {
    const baseDir = options.baseDir ?? DEFAULT_DIR;
    const ttlMs = options.ttlMs ?? DEFAULT_NOTIFICATION_SESSION_TTL_MS;
    const now = options.now ?? Date.now;
    let cached = null;
    const readFromDisk = () => {
        try {
            const parsed = JSON.parse(fs.readFileSync(targetPath(baseDir), "utf-8"));
            const target = parseTarget(parsed);
            if (!target)
                return null;
            return isFresh(target, now(), ttlMs) ? target : null;
        }
        catch {
            return null;
        }
    };
    return {
        remember(sessionKey, source, deliveryContext) {
            if (!sessionKey)
                return null;
            const target = {
                sessionKey,
                source,
                updatedAt: now(),
                deliveryContext,
            };
            cached = target;
            try {
                ensureDir(baseDir);
                fs.writeFileSync(targetPath(baseDir), JSON.stringify(target, null, 2), { mode: 0o600 });
            }
            catch (err) {
                options.logger?.warn?.(`Could not persist mesh active session target: ${err}`);
            }
            return target;
        },
        getCurrent() {
            if (cached && isFresh(cached, now(), ttlMs)) {
                return cached;
            }
            cached = readFromDisk();
            if (!cached) {
                options.logger?.debug?.("No fresh mesh active session target available for notification");
            }
            return cached;
        },
    };
}
