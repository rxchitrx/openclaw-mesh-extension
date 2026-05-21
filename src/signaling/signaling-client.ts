import type { SignalMessage, SignalMessageType } from "./signaling-protocol.js";

export class SignalingClient {
  private ws: any = null;
  private logger: any;
  private localNodeName: string;

  public onPeerJoin?: (peerName: string) => void;
  public onPeerLeave?: (peerName: string) => void;
  public onSignalMessage?: (msg: SignalMessage) => void;

  constructor(localNodeName: string, logger: any) {
    this.localNodeName = localNodeName;
    this.logger = logger;
  }

  public async connect(serverUrl: string): Promise<void> {
    const wsModule = await import("ws");
    
    return new Promise((resolve, reject) => {
      this.ws = new wsModule.default(serverUrl);

      this.ws.on("open", () => {
        this.logger.info(`[SIGNAL] Connected to signaling server at ${serverUrl}`);
        this.send({ type: "register", from: this.localNodeName });
        resolve();
      });

      this.ws.on("message", (data: any) => {
        try {
          const raw = typeof data === "string" ? data : data.toString("utf-8");
          const msg = JSON.parse(raw) as SignalMessage;

          switch (msg.type) {
            case "peer_join":
              if (this.onPeerJoin) this.onPeerJoin(msg.from);
              break;
            case "peer_leave":
              if (this.onPeerLeave) this.onPeerLeave(msg.from);
              break;
            case "signal_offer":
            case "signal_answer":
            case "ice_candidate":
              if (this.onSignalMessage) this.onSignalMessage(msg);
              break;
          }
        } catch (err) {
          this.logger.error(`[SIGNAL] Failed to parse signaling message: ${err}`);
        }
      });

      this.ws.on("error", (err: Error) => {
        this.logger.error(`[SIGNAL] Connection error: ${err}`);
        reject(err);
      });

      this.ws.on("close", () => {
        this.logger.info(`[SIGNAL] Disconnected from signaling server.`);
      });
    });
  }

  public send(msg: SignalMessage): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.logger.warn(`[SIGNAL] Cannot send message, not connected: ${msg.type}`);
    }
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
