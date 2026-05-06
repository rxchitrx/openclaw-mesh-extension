export type PeerInfo = {
    name: string;
    host: string;
    port: number;
    lastSeen: number;
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
};
export declare function createDiscovery(config: DiscoveryConfig): DiscoveryService;
