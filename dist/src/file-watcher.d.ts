import type { CRDTService } from "./crdt.js";
export type FileWatcherConfig = {
    workspaceDir: string;
    crdt: CRDTService;
    logger: any;
};
export type TrackedFile = {
    relativePath: string;
    isBinary: boolean;
    hash: string;
    size: number;
};
export type FileWatcherService = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    getWatchedFiles: () => string[];
    getManifest: () => TrackedFile[];
    syncAllFiles: () => Promise<void>;
    getFileContent: (relativePath: string) => Promise<{
        content: string;
        isBinary: boolean;
    } | null>;
    onFileDeleted: ((relativePath: string) => void) | null;
};
export declare function createFileWatcher(config: FileWatcherConfig): FileWatcherService;
