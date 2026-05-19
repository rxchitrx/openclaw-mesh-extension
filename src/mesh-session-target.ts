import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const DEFAULT_NOTIFICATION_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

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

const DEFAULT_DIR = path.join(os.homedir(), ".openclaw", "mesh");

function targetPath(baseDir: string): string {
  return path.join(baseDir, "active-session.json");
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseTarget(value: unknown): MeshSessionTarget | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.sessionKey !== "string" || candidate.sessionKey.length === 0) return null;
  if (typeof candidate.updatedAt !== "number" || !Number.isFinite(candidate.updatedAt)) return null;
  return {
    sessionKey: candidate.sessionKey,
    updatedAt: candidate.updatedAt,
    source: typeof candidate.source === "string" ? candidate.source : "unknown",
    deliveryContext: candidate.deliveryContext,
  };
}

function isFresh(target: MeshSessionTarget, now: number, ttlMs: number): boolean {
  return now - target.updatedAt <= ttlMs;
}

export function createMeshSessionTargetStore(
  options: MeshSessionTargetStoreOptions = {},
): MeshSessionTargetStore {
  const baseDir = options.baseDir ?? DEFAULT_DIR;
  const ttlMs = options.ttlMs ?? DEFAULT_NOTIFICATION_SESSION_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: MeshSessionTarget | null = null;

  const readFromDisk = (): MeshSessionTarget | null => {
    try {
      const parsed = JSON.parse(fs.readFileSync(targetPath(baseDir), "utf-8"));
      const target = parseTarget(parsed);
      if (!target) return null;
      return isFresh(target, now(), ttlMs) ? target : null;
    } catch {
      return null;
    }
  };

  return {
    remember(sessionKey, source, deliveryContext) {
      if (!sessionKey) return null;
      const previous = cached?.sessionKey === sessionKey ? cached : readFromDisk();
      const target: MeshSessionTarget = {
        sessionKey,
        source,
        updatedAt: now(),
        deliveryContext: deliveryContext ?? (previous?.sessionKey === sessionKey ? previous.deliveryContext : undefined),
      };
      cached = target;
      try {
        ensureDir(baseDir);
        fs.writeFileSync(targetPath(baseDir), JSON.stringify(target, null, 2), { mode: 0o600 });
      } catch (err) {
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
