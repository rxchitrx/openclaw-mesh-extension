import { RTCPeerConnection } from "werift-webrtc";
import type { PeerTransport, TransportType } from "./peer-transport.js";
import type { SignalingClient } from "../signaling/signaling-client.js";

export class WebRTCTransport implements PeerTransport {
  readonly type: TransportType = "webrtc";
  
  private pc: RTCPeerConnection;
  private dc?: any;
  private signalingClient: SignalingClient;
  private localPeerName: string;
  private remotePeerName: string;
  private isInitiator: boolean;
  private logger: any;

  // Handlers for PeerTransport interface
  private openHandler?: () => void;
  private messageHandler?: (data: string) => void;
  private disconnectHandler?: () => void;
  private errorHandler?: (err: Error) => void;

  constructor(
    localPeerName: string,
    remotePeerName: string,
    signalingClient: SignalingClient,
    isInitiator: boolean,
    logger: any
  ) {
    this.localPeerName = localPeerName;
    this.remotePeerName = remotePeerName;
    this.signalingClient = signalingClient;
    this.isInitiator = isInitiator;
    this.logger = logger;

    // Use Google's public STUN server for ICE
    this.pc = new RTCPeerConnection({
      stunServer: ["stun.l.google.com", 19302]
    });

    this.setupPeerConnection();

    if (this.isInitiator) {
      this.dc = this.pc.createDataChannel("mesh-sync");
      this.setupDataChannel(this.dc);
    } else {
      this.pc.datachannel.subscribe((channel: any) => {
        this.dc = channel;
        this.setupDataChannel(channel);
      });
    }
  }

  private setupPeerConnection() {
    this.pc.iceConnectionStateChange.subscribe((state) => {
      this.logger.info(`[WEBRTC] ICE connection state to ${this.remotePeerName}: ${state}`);
      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.close();
      }
    });
  }

  private earlyMessages: string[] = [];

  private setupDataChannel(channel: any) {
    channel.message.subscribe((data: any) => {
      const raw = Buffer.isBuffer(data) ? data.toString("utf-8") : data;
      if (this.messageHandler) {
        this.messageHandler(raw);
      } else {
        this.logger.info(`[WEBRTC] Early message buffered from ${this.remotePeerName} (${raw.substring(0, 80)}...)`);
        this.earlyMessages.push(raw);
      }
    });

    channel.stateChanged.subscribe((state) => {
      if (state === "open") {
        this.logger.info(`[WEBRTC] DataChannel open to ${this.remotePeerName}`);
        if (this.openHandler) this.openHandler();
      } else if (state === "closed") {
        this.close();
      }
    });
  }

  public async initiate(): Promise<void> {
    if (!this.isInitiator) return;
    this.logger.info(`[WEBRTC] Creating offer for ${this.remotePeerName}`);
    
    const offer = this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    
    // werift gathers ICE automatically. Wait a moment for candidates.
    await new Promise(r => setTimeout(r, 500));

    this.signalingClient.send({
      type: "signal_offer",
      from: this.localPeerName,
      target: this.remotePeerName,
      payload: this.pc.localDescription
    });
  }

  public async handleOffer(offer: any): Promise<void> {
    this.logger.info(`[WEBRTC] Handling offer from ${this.remotePeerName}`);
    await this.pc.setRemoteDescription(offer);
    
    const answer = this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    
    await new Promise(r => setTimeout(r, 500));

    this.signalingClient.send({
      type: "signal_answer",
      from: this.localPeerName,
      target: this.remotePeerName,
      payload: this.pc.localDescription
    });
  }

  public async handleAnswer(answer: any): Promise<void> {
    this.logger.info(`[WEBRTC] Received answer from ${this.remotePeerName}`);
    await this.pc.setRemoteDescription(answer);
  }

  public async handleIceCandidate(candidate: any): Promise<void> {
    // werift doesn't use trickle ICE via addIceCandidate, so we ignore these.
  }

  // PeerTransport Implementation

  private isClosed = false;

  send(message: string): void {
    if (this.isOpen() && this.dc) {
      this.dc.send(Buffer.from(message));
    }
  }

  isOpen(): boolean {
    return this.dc?.readyState === "open" && !this.isClosed;
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.dc) {
      try { this.dc.close(); } catch {}
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
    }
    if (this.disconnectHandler) {
      this.disconnectHandler();
      this.disconnectHandler = undefined;
    }
  }

  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
    if (this.earlyMessages.length > 0) {
      this.logger.info(`[WEBRTC] Flushing ${this.earlyMessages.length} early message(s) for ${this.remotePeerName}`);
    }
    while (this.earlyMessages.length > 0) {
      const raw = this.earlyMessages.shift();
      if (raw) handler(raw);
    }
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandler = handler;
  }

  getRawSocket(): any {
    return this.dc;
  }
}
