import type { CRDTService } from "./crdt.js";
export type FileWatcherConfig = {
    workspaceDir: string;
    crdt: CRDTService;
    logger: any;
};
export type FileWatcherService = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    getWatchedFiles: () => string[];
    syncAllFiles: () => Promise<void>;
};
export declare function createFileWatcher(config: FileWatcherConfig): FileWatcherService;
