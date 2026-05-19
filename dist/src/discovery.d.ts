export type PeerInfo = {
    name: string;
    host: string;
    port: number;
    lastSeen: number;
    source: "mdns" | "transport" | "subnet-scan" | "ping";
    lastTransportSeen?: number;
    lastMdnsSeen?: number;
    lastScanSeen?: number;
    lastPingSeen?: number;
};
export type DiscoveryConfig = {
    nodeName: string;
    port: number;
    logger: any;
};
export type DiscoveryService = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    scan: () => Promise<void>;
    getPeers: () => PeerInfo[];
    getLocalNode: () => {
        name: string;
        host: string;
        port: number;
    };
    notePeer: (peer: {
        name: string;
        host: string;
        port?: number;
        source?: "mdns" | "transport" | "subnet-scan";
    }) => void;
};
export declare function getLocalIPv4Addresses(): string[];
export declare function normalizePeerHost(host: string): string;
export declare function isLocalIPv4Address(host: string): boolean;
export declare function createDiscovery(config: DiscoveryConfig): DiscoveryService;
