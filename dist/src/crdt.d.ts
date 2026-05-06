export type CRDTConfig = {
    nodeName: string;
    logger: any;
};
export type FileState = {
    path: string;
    content: string;
    isBinary: boolean;
    lastModified: number;
    author: string;
};
export type Delta = {
    file: string;
    changes: any[];
    timestamp: number;
    author: string;
    isBinary: boolean;
};
export type CRDTService = {
    getState: (file?: string) => any;
    applyLocalChange: (file: string, content: string, isBinary?: boolean) => Promise<Delta | null>;
    applyRemoteDelta: (delta: Delta, file: string) => void;
    applyRemoteBinary: (file: string, content: string) => void;
    mergeState: (state: any, file: string) => void;
    getFileContent: (file: string) => string | null;
    isFileBinary: (file: string) => boolean;
    getFiles: () => string[];
    syncPendingDeltas: () => Promise<void>;
    getPendingDeltas: () => Delta[];
    getPendingDeltasForFile: (file: string) => Delta[];
};
export declare function createCRDT(config: CRDTConfig): CRDTService;
