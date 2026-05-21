import type { SignalMessage } from "./signaling-protocol.js";
export declare class SignalingClient {
    private ws;
    private logger;
    private localNodeName;
    onPeerJoin?: (peerName: string) => void;
    onPeerLeave?: (peerName: string) => void;
    onSignalMessage?: (msg: SignalMessage) => void;
    constructor(localNodeName: string, logger: any);
    connect(serverUrl: string): Promise<void>;
    send(msg: SignalMessage): void;
    disconnect(): void;
}
