import type { TrackedFile } from "./file-watcher.js";
export declare const MAX_RAW_MESSAGE_BYTES: number;
export declare const MAX_FILE_CONTENT_BYTES: number;
export declare const MAX_PREVIEW_CONTENT_BYTES: number;
export declare const MAX_MANIFEST_FILES = 5000;
export declare const MAX_PATH_LENGTH = 512;
export declare const MAX_STRING_FIELD_LENGTH = 1024;
export declare const MAX_CAPABILITY_INSTRUCTION_LENGTH: number;
export type ValidationResult<T> = any;
export type BaseMeshMessage = {
    type: string;
};
export type ApprovalResponseMessage = BaseMeshMessage & {
    type: "approval_response";
    approved: boolean;
};
export type NodeInfoMessage = BaseMeshMessage & {
    type: "node_info";
    nodeName: string;
    trackingDir: string | null;
    trackingFileCount: number;
    trackingFiles: string[];
    capabilities: string[];
};
export type ManifestMessage = BaseMeshMessage & {
    type: "manifest";
    files: TrackedFile[];
    droppedEntries: number;
};
export type FileContentMessage = BaseMeshMessage & {
    type: "file_content";
    path: string;
    content: string;
    isBinary: boolean;
    hash?: string;
};
export type FileChunkMessage = BaseMeshMessage & {
    type: "file_chunk";
    path: string;
    chunkIndex: number;
    totalChunks: number;
    chunk: string;
    isBinary: boolean;
    hash?: string;
};
export type FilePathMessage = BaseMeshMessage & {
    path: string;
};
export type FilePreviewRequestMessage = FilePathMessage & {
    type: "file_preview_request";
    requestId: string;
};
export type FilePreviewResponseMessage = FilePathMessage & {
    type: "file_preview_response";
    requestId: string;
    content?: string;
    isBinary: boolean;
    hash?: string;
    error?: string;
};
export type FileAppliedMessage = FilePathMessage & {
    type: "file_applied";
    hash?: string;
    appliedAt: number;
    from?: string;
};
export type FileRejectedMessage = FilePathMessage & {
    type: "file_rejected";
    hash?: string;
    rejectedAt: number;
    from?: string;
    reason: string;
};
export type CapabilityExecuteMessage = BaseMeshMessage & {
    type: "capability_execute";
    requestId?: string;
    capability: string;
    instruction: string;
    from: string;
};
export type CapabilityExecuteResultMessage = BaseMeshMessage & {
    type: "capability_execute_result";
    requestId: string;
    result?: unknown;
    error?: string;
    from: string;
};
export declare function parseMeshMessage(raw: string): ValidationResult<BaseMeshMessage & Record<string, unknown>>;
export declare function isRawMessageTooLarge(byteLength: number): boolean;
export declare function validateApprovalResponse(message: Record<string, unknown>): ValidationResult<ApprovalResponseMessage>;
export declare function validateNodeInfo(message: Record<string, unknown>): ValidationResult<NodeInfoMessage>;
export declare function validateManifest(message: Record<string, unknown>): ValidationResult<ManifestMessage>;
export declare function validateFileContent(message: Record<string, unknown>): ValidationResult<FileContentMessage>;
export declare function validateFileChunk(message: Record<string, unknown>): ValidationResult<FileChunkMessage>;
export declare function validateFilePathMessage<T extends string>(message: Record<string, unknown>, type: T): ValidationResult<FilePathMessage & {
    type: T;
}>;
export declare function validateFilePreviewRequest(message: Record<string, unknown>): ValidationResult<FilePreviewRequestMessage>;
export declare function validateFilePreviewResponse(message: Record<string, unknown>): ValidationResult<FilePreviewResponseMessage>;
export declare function validateFileApplied(message: Record<string, unknown>): ValidationResult<FileAppliedMessage>;
export declare function validateFileRejected(message: Record<string, unknown>): ValidationResult<FileRejectedMessage>;
export declare function validateCapabilityExecute(message: Record<string, unknown>): ValidationResult<CapabilityExecuteMessage>;
export declare function validateCapabilityExecuteResult(message: Record<string, unknown>): ValidationResult<CapabilityExecuteResultMessage>;
