import type { PeerTransport, TransportType } from "./peer-transport.js";
/**
 * Placeholder scaffolding for future internet-capable remote transport.
 * DO NOT fully implement signaling or ICE negotiation in this phase.
 */
export declare class WebRTCTransport implements PeerTransport {
    readonly type: TransportType;
    constructor();
    send(message: string): void;
    isOpen(): boolean;
    close(): void;
    onMessage(handler: (data: string) => void): void;
    onDisconnect(handler: () => void): void;
    onError(handler: (err: Error) => void): void;
}
