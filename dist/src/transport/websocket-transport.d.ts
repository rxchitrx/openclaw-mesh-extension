import type { PeerTransport, TransportType } from "./peer-transport.js";
export declare class WebSocketTransport implements PeerTransport {
    private socket;
    readonly type: TransportType;
    private messageHandlers;
    private disconnectHandlers;
    private errorHandlers;
    constructor(socket: any);
    private setupListeners;
    send(message: string): void;
    isOpen(): boolean;
    close(): void;
    onMessage(handler: (data: string) => void): void;
    onDisconnect(handler: () => void): void;
    onError(handler: (err: Error) => void): void;
    getRawSocket(): any;
}
