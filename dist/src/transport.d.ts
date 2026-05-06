import type { CRDTService } from "./crdt.js";
import type { PeerInfo } from "./discovery.js";
import type { TrackedFile } from "./file-watcher.js";
export type TransportConfig = {
    nodeName: string;
    port: number;
    crdt: CRDTService;
    logger: any;
};
export type Connection = {
    peerName: string;
    socket: any;
    isAlive: boolean;
    approved: boolean;
    manifest?: TrackedFile[];
};
export type PendingConnection = {
    peerName: string;
    socket: any;
    host: string;
    connectedAt: number;
};
export type NodeInfo = {
    nodeName: string;
    trackingDir: string | null;
    trackingFileCount: number;
    trackingFiles: string[];
};
export type TransportNotification = {
    type: "peer_pending" | "peer_approved" | "peer_denied" | "peer_disconnected" | "file_deleted" | "conflict" | "manifest_received" | "node_info_received";
    message: string;
    peerName?: string;
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
    sendLocalManifest: (peerName: string, manifest: TrackedFile[]) => void;
    notifyFileDeleted: (relativePath: string) => void;
    setNotificationHandler: (handler: (notification: TransportNotification) => void) => void;
    maintainConnections: () => Promise<void>;
    getNodeInfo: (peerName: string) => NodeInfo | null;
    setNodeInfoProvider: (provider: () => NodeInfo) => void;
    setFileContentProvider: (provider: (relativePath: string) => Promise<{
        content: string;
        isBinary: boolean;
    } | null>) => void;
    setManifestProvider: (provider: () => TrackedFile[]) => void;
    setFileWriter: (writer: (relativePath: string, content: string, isBinary: boolean) => Promise<void>) => void;
};
export declare function createTransport(config: TransportConfig): TransportService;
