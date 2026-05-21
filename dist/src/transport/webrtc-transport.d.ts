import type { PeerTransport, TransportType } from "./peer-transport.js";
import type { SignalingClient } from "../signaling/signaling-client.js";
export declare class WebRTCTransport implements PeerTransport {
    readonly type: TransportType;
    private pc;
    private dc?;
    private signalingClient;
    private localPeerName;
    private remotePeerName;
    private isInitiator;
    private logger;
    private messageHandler?;
    private disconnectHandler?;
    private errorHandler?;
    constructor(localPeerName: string, remotePeerName: string, signalingClient: SignalingClient, isInitiator: boolean, logger: any);
    private setupPeerConnection;
    private setupDataChannel;
    initiate(): Promise<void>;
    handleOffer(offer: any): Promise<void>;
    handleAnswer(answer: any): Promise<void>;
    handleIceCandidate(candidate: any): Promise<void>;
    send(message: string): void;
    isOpen(): boolean;
    close(): void;
    onMessage(handler: (data: string) => void): void;
    onDisconnect(handler: () => void): void;
    onError(handler: (err: Error) => void): void;
    getRawSocket(): any;
}
