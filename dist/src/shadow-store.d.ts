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
export declare function createShadowStore(shadowDir?: string): ShadowStore;
