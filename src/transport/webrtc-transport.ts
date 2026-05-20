import type { PeerTransport, TransportType } from "./peer-transport.js";

/**
 * Placeholder scaffolding for future internet-capable remote transport.
 * DO NOT fully implement signaling or ICE negotiation in this phase.
 */
export class WebRTCTransport implements PeerTransport {
  readonly type: TransportType = "webrtc";

  constructor() {
    throw new Error("NotImplemented: WebRTCTransport is not yet supported.");
  }

  send(message: string): void {
    throw new Error("Method not implemented.");
  }

  isOpen(): boolean {
    throw new Error("Method not implemented.");
  }

  close(): void {
    throw new Error("Method not implemented.");
  }

  onMessage(handler: (data: string) => void): void {
    throw new Error("Method not implemented.");
  }

  onDisconnect(handler: () => void): void {
    throw new Error("Method not implemented.");
  }

  onError(handler: (err: Error) => void): void {
    throw new Error("Method not implemented.");
  }
}
