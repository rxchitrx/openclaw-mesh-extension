export type TransportType = "lan" | "webrtc";
export interface PeerTransport {
    readonly type: TransportType;
    /**
     * Send a stringified JSON payload over the transport.
     */
    send(message: string): void;
    /**
     * Close the transport connection.
     */
    close(): void;
    /**
     * Register a handler for incoming messages.
     */
    onMessage(handler: (data: string) => void): void;
    /**
     * Register a handler for when the connection disconnects.
     */
    onDisconnect(handler: () => void): void;
    /**
     * Register a handler for connection errors.
     */
    onError(handler: (err: Error) => void): void;
    /**
     * Check if the transport is currently open and ready to send data.
     */
    isOpen(): boolean;
    /**
     * Returns the underlying socket or data channel for logging/debugging (optional).
     */
    getRawSocket?(): any;
}
