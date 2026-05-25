import { RTCPeerConnection } from "werift-webrtc";
export class WebRTCTransport {
    type = "webrtc";
    pc;
    dc;
    signalingClient;
    localPeerName;
    remotePeerName;
    isInitiator;
    logger;
    // Handlers for PeerTransport interface
    openHandler;
    messageHandler;
    disconnectHandler;
    errorHandler;
    constructor(localPeerName, remotePeerName, signalingClient, isInitiator, logger) {
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
        }
        else {
            this.pc.datachannel.subscribe((channel) => {
                this.dc = channel;
                this.setupDataChannel(channel);
            });
        }
    }
    setupPeerConnection() {
        this.pc.iceConnectionStateChange.subscribe((state) => {
            this.logger.info(`[WEBRTC] ICE connection state to ${this.remotePeerName}: ${state}`);
            if (state === "disconnected" || state === "failed" || state === "closed") {
                this.close();
            }
        });
    }
    earlyMessages = [];
    setupDataChannel(channel) {
        channel.message.subscribe((data) => {
            const raw = Buffer.isBuffer(data) ? data.toString("utf-8") : data;
            if (this.messageHandler) {
                this.messageHandler(raw);
            }
            else {
                this.logger.info(`[WEBRTC] Early message buffered from ${this.remotePeerName} (${raw.substring(0, 80)}...)`);
                this.earlyMessages.push(raw);
            }
        });
        channel.stateChanged.subscribe((state) => {
            if (state === "open") {
                this.logger.info(`[WEBRTC] DataChannel open to ${this.remotePeerName}`);
                if (this.openHandler)
                    this.openHandler();
            }
            else if (state === "closed") {
                this.close();
            }
        });
    }
    async initiate() {
        if (!this.isInitiator)
            return;
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
    async handleOffer(offer) {
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
    async handleAnswer(answer) {
        this.logger.info(`[WEBRTC] Received answer from ${this.remotePeerName}`);
        await this.pc.setRemoteDescription(answer);
    }
    async handleIceCandidate(candidate) {
        // werift doesn't use trickle ICE via addIceCandidate, so we ignore these.
    }
    // PeerTransport Implementation
    isClosed = false;
    send(message) {
        if (this.isOpen() && this.dc) {
            this.dc.send(Buffer.from(message));
        }
    }
    isOpen() {
        return this.dc?.readyState === "open" && !this.isClosed;
    }
    close() {
        if (this.isClosed)
            return;
        this.isClosed = true;
        if (this.dc) {
            try {
                this.dc.close();
            }
            catch { }
        }
        if (this.pc) {
            try {
                this.pc.close();
            }
            catch { }
        }
        if (this.disconnectHandler) {
            this.disconnectHandler();
            this.disconnectHandler = undefined;
        }
    }
    onOpen(handler) {
        this.openHandler = handler;
    }
    onMessage(handler) {
        this.messageHandler = handler;
        if (this.earlyMessages.length > 0) {
            this.logger.info(`[WEBRTC] Flushing ${this.earlyMessages.length} early message(s) for ${this.remotePeerName}`);
        }
        while (this.earlyMessages.length > 0) {
            const raw = this.earlyMessages.shift();
            if (raw)
                handler(raw);
        }
    }
    onDisconnect(handler) {
        this.disconnectHandler = handler;
    }
    onError(handler) {
        this.errorHandler = handler;
    }
    getRawSocket() {
        return this.dc;
    }
}
