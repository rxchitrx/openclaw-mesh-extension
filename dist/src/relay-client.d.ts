import { type MeshIdentity } from "./peer-identity.js";
export type RelayClientConfig = {
    url: string;
    room: string;
    token?: string;
    nodeName: string;
    identity: MeshIdentity;
    logger: any;
};
export type RelayPeer = {
    name: string;
    fingerprint?: string;
    publicKey?: string;
    lastSeen: number;
};
export type RelayMessage = {
    from: string;
    payload: string;
};
type RelayClientEvents = {
    peer: (peer: RelayPeer) => void;
    peerGone: (peerName: string) => void;
    message: (message: RelayMessage) => void;
    status: (status: "connected" | "disconnected" | "error", detail?: string) => void;
};
export declare class RelayClient {
    private readonly config;
    private ws;
    private connected;
    private stopping;
    private reconnectTimer;
    private readonly emitter;
    constructor(config: RelayClientConfig);
    on<K extends keyof RelayClientEvents>(event: K, handler: RelayClientEvents[K]): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    isConnected(): boolean;
    send(to: string, payload: string): boolean;
    private open;
    private handleFrame;
    private scheduleReconnect;
}
export {};
