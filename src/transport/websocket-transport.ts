import type { PeerTransport, TransportType } from "./peer-transport.js";

export class WebSocketTransport implements PeerTransport {
  readonly type: TransportType = "lan";
  
  private messageHandlers: Array<(data: string) => void> = [];
  private disconnectHandlers: Array<() => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];

  constructor(private socket: any) {
    this.setupListeners();
  }

  private setupListeners() {
    this.socket.on("message", (data: any) => {
      // Handle both string and buffer inputs seamlessly
      const message = typeof data === "string" ? data : data.toString("utf-8");
      for (const handler of this.messageHandlers) {
        handler(message);
      }
    });

    this.socket.on("close", () => {
      for (const handler of this.disconnectHandlers) {
        handler();
      }
    });

    this.socket.on("error", (err: Error) => {
      for (const handler of this.errorHandlers) {
        handler(err);
      }
    });
  }

  send(message: string): void {
    if (this.isOpen()) {
      this.socket.send(message);
    }
  }

  isOpen(): boolean {
    return this.socket && this.socket.readyState === 1; // 1 === OPEN
  }

  close(): void {
    if (this.socket) {
      this.socket.close();
    }
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandlers.push(handler);
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  getRawSocket(): any {
    return this.socket;
  }
}
