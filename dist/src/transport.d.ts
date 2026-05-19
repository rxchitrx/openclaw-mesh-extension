import type { SyncStateService } from "./sync-state.js";
import type { PeerInfo } from "./discovery.js";
import type { TrackedFile } from "./file-watcher.js";
export type TransportConfig = {
    nodeName: string;
    port: number;
    syncState: SyncStateService;
    logger: any;
};
export type Connection = {
    peerName: string;
    socket: any;
    isAlive: boolean;
    approved: boolean;
    fingerprint?: string;
    publicKey?: string;
    identityVerified?: boolean;
};
export type PendingConnection = {
    peerName: string;
    socket: any;
    host: string;
    connectedAt: number;
    fingerprint?: string;
    publicKey?: string;
    identityVerified?: boolean;
    fingerprintMismatch?: boolean;
};
export type NodeInfo = {
    nodeName: string;
    trackingDir: string | null;
    trackingFileCount: number;
    trackingFiles: string[];
};
export type RemoteApplyRecord = {
    path: string;
    hash?: string;
    appliedAt: number;
    from: string;
};
export type RemoteRejectRecord = {
    path: string;
    hash?: string;
    rejectedAt: number;
    from: string;
    reason: string;
};
export type InFlightSendRecord = {
    path: string;
    hash?: string;
    sentAt: number;
    peerName: string;
};
export type FilePreview = {
    path: string;
    content: string;
    isBinary: boolean;
    hash?: string | null;
};
export type TransportNotification = {
    type: "peer_pending" | "peer_approved" | "peer_denied" | "peer_connected" | "peer_disconnected" | "file_deleted" | "file_conflict" | "conflict" | "manifest_received" | "node_info_received" | "sync_requested" | "sync_applied" | "sync_failed" | "file_sent" | "file_received" | "file_written" | "file_rejected" | "file_preview";
    message: string;
    peerName?: string;
    filePath?: string;
    data?: any;
};
export type TransportService = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    connectToPeer: (peer: PeerInfo) => Promise<boolean>;
    broadcast: (message: any) => void;
    sendToPeer: (peerName: string, message: any) => void;
    getConnections: () => string[];
    getPendingConnections: () => PendingConnection[];
    approveConnection: (peerName: string) => boolean;
    denyConnection: (peerName: string) => boolean;
    getRemoteManifest: (peerName: string) => TrackedFile[] | null;
    requestManifest: (peerName: string) => void;
    sendFileContent: (peerName: string, relativePath: string, content: string, isBinary: boolean) => void;
    requestFileContent: (peerName: string, relativePath: string) => void;
    requestFilePreview: (peerName: string, relativePath: string, timeoutMs?: number) => Promise<FilePreview | null>;
    sendLocalManifest: (peerName: string, manifest: TrackedFile[]) => void;
    notifyFileDeleted: (relativePath: string) => void;
    setNotificationHandler: (handler: (notification: TransportNotification) => void) => void;
    maintainConnections: () => Promise<void>;
    getNodeInfo: (peerName: string) => NodeInfo | null;
    getRemoteAppliedFiles: (peerName: string) => RemoteApplyRecord[];
    getRemoteRejectedFiles: (peerName: string) => RemoteRejectRecord[];
    getInFlightSends: (peerName?: string) => InFlightSendRecord[];
    getPeerFingerprint: (peerName: string) => string | null;
    getPeerTrustWarning: (peerName: string) => string | null;
    setNodeInfoProvider: (provider: () => NodeInfo) => void;
    setFileContentProvider: (provider: (relativePath: string) => Promise<{
        content: string;
        isBinary: boolean;
    } | null>) => void;
    setManifestProvider: (provider: () => TrackedFile[]) => void;
    setFileWriter: (writer: (relativePath: string, content: string, isBinary: boolean) => Promise<void>) => void;
    setIgnoreNextChange: (fn: (relativePath: string) => void) => void;
};
export declare function createTransport(config: TransportConfig): TransportService;
