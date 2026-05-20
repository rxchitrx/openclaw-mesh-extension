/**
 * Placeholder scaffolding for future internet-capable remote transport.
 * DO NOT fully implement signaling or ICE negotiation in this phase.
 */
export class WebRTCTransport {
    type = "webrtc";
    constructor() {
        throw new Error("NotImplemented: WebRTCTransport is not yet supported.");
    }
    send(message) {
        throw new Error("Method not implemented.");
    }
    isOpen() {
        throw new Error("Method not implemented.");
    }
    close() {
        throw new Error("Method not implemented.");
    }
    onMessage(handler) {
        throw new Error("Method not implemented.");
    }
    onDisconnect(handler) {
        throw new Error("Method not implemented.");
    }
    onError(handler) {
        throw new Error("Method not implemented.");
    }
}
