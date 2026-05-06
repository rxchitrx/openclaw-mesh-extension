export type CRDTConfig = {
    nodeName: string;
    logger: any;
};
export type FileState = {
    path: string;
    content: string;
    lastModified: number;
    author: string;
};
export type Delta = {
    file: string;
    changes: any[];
    timestamp: number;
    author: string;
};
export type CRDTService = {
    getState: (file?: string) => any;
    applyLocalChange: (file: string, content: string) => Promise<Delta | null>;
    applyRemoteDelta: (delta: Delta, file: string) => void;
    mergeState: (state: any, file: string) => void;
    getFileContent: (file: string) => string | null;
    getFiles: () => string[];
    syncPendingDeltas: () => Promise<void>;
    getPendingDeltas: () => Delta[];
};
export declare function createCRDT(config: CRDTConfig): CRDTService;
