import type { TrackedFile } from "./file-watcher.js";
export type DiffSide = {
    file?: TrackedFile;
    content?: string;
};
export type DiffPreviewOptions = {
    path: string;
    local?: DiffSide;
    remote?: DiffSide;
    contextLines?: number;
    maxBytes?: number;
};
export type DiffPreview = {
    path: string;
    kind: "added" | "deleted" | "modified" | "binary" | "large" | "unchanged";
    isBinary: boolean;
    localHash?: string;
    remoteHash?: string;
    localSize?: number;
    remoteSize?: number;
    patch?: string;
    summary: string;
};
export declare function createDiffPreview(options: DiffPreviewOptions): DiffPreview;
export declare function createPatchPayload(path: string, oldText: string, newText: string, parentHash: string, targetHash: string, contextLines?: number): {
    patch: string;
    parentHash: string;
    targetHash: string;
};
