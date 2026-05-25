/**
 * shadow-store.ts
 *
 * Stores file content snapshots on disk, keyed by their SHA-256 hash.
 * Used by the patch-sync system to know what content was last sent to a peer,
 * so we can diff against it locally without any network round-trips.
 *
 * Philosophy: Zero RAM usage. All data lives on disk and is read on-demand,
 * consistent with the on-demand disk-read approach used in file-watcher.ts.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const DEFAULT_SHADOW_DIR = path.join(os.homedir(), ".openclaw", "mesh", "shadows");

export type ShadowStore = {
  /**
   * Write file content to the shadow store, keyed by its hash.
   * If a shadow for this hash already exists, this is a no-op (content is immutable by hash).
   */
  write(hash: string, content: string): void;

  /**
   * Read the content of a shadow file by hash.
   * Returns null if the shadow does not exist or cannot be read.
   */
  read(hash: string): string | null;

  /**
   * Delete shadow files that are no longer referenced by any peer.
   * Pass the full set of hashes that are still in use.
   */
  prune(referencedHashes: Set<string>): void;
};

function isSafeHash(hash: string): boolean {
  // Allow only hex strings (SHA-256 is 64 hex chars) to prevent path traversal
  return /^[0-9a-f]{8,128}$/.test(hash);
}

export function createShadowStore(shadowDir?: string): ShadowStore {
  const dir = shadowDir ?? DEFAULT_SHADOW_DIR;

  function ensureDir(): boolean {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  function shadowPath(hash: string): string {
    return path.join(dir, hash);
  }

  return {
    write(hash: string, content: string): void {
      if (!isSafeHash(hash)) return;
      const target = shadowPath(hash);
      // Skip if shadow already exists — content is immutable for a given hash
      try {
        fs.accessSync(target, fs.constants.F_OK);
        return; // already exists
      } catch {
        // doesn't exist, write it
      }
      if (!ensureDir()) return;
      try {
        fs.writeFileSync(target, content, { encoding: "utf-8", mode: 0o600 });
      } catch {
        // Non-fatal: worst case we fall back to full file sync on next change
      }
    },

    read(hash: string): string | null {
      if (!isSafeHash(hash)) return null;
      try {
        return fs.readFileSync(shadowPath(hash), "utf-8");
      } catch {
        return null;
      }
    },

    prune(referencedHashes: Set<string>): void {
      try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (isSafeHash(entry) && !referencedHashes.has(entry)) {
            try {
              fs.unlinkSync(path.join(dir, entry));
            } catch {
              // ignore individual deletion errors
            }
          }
        }
      } catch {
        // ignore if directory doesn't exist yet
      }
    },
  };
}
