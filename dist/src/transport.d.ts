import type { CRDTService } from "./crdt.js";
import type { PeerInfo } from "./discovery.js";
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
};
export type TransportService = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    connectToPeer: (peer: PeerInfo) => Promise<boolean>;
    broadcast: (message: any) => void;
    getConnections: () => string[];
    maintainConnections: () => Promise<void>;
};
export declare function createTransport(config: TransportConfig): TransportService;
