export class SignalingClient {
    ws = null;
    logger;
    localNodeName;
    onPeerJoin;
    onPeerLeave;
    onSignalMessage;
    constructor(localNodeName, logger) {
        this.localNodeName = localNodeName;
        this.logger = logger;
    }
    async connect(serverUrl) {
        const wsModule = await import("ws");
        return new Promise((resolve, reject) => {
            this.ws = new wsModule.default(serverUrl);
            this.ws.on("open", () => {
                this.logger.info(`[SIGNAL] Connected to signaling server at ${serverUrl}`);
                this.send({ type: "register", from: this.localNodeName });
                resolve();
            });
            this.ws.on("message", (data) => {
                try {
                    const raw = typeof data === "string" ? data : data.toString("utf-8");
                    const msg = JSON.parse(raw);
                    switch (msg.type) {
                        case "peer_join":
                            if (this.onPeerJoin)
                                this.onPeerJoin(msg.from);
                            break;
                        case "peer_leave":
                            if (this.onPeerLeave)
                                this.onPeerLeave(msg.from);
                            break;
                        case "signal_offer":
                        case "signal_answer":
                        case "ice_candidate":
                            if (this.onSignalMessage)
                                this.onSignalMessage(msg);
                            break;
                    }
                }
                catch (err) {
                    this.logger.error(`[SIGNAL] Failed to parse signaling message: ${err}`);
                }
            });
            this.ws.on("error", (err) => {
                this.logger.error(`[SIGNAL] Connection error: ${err}`);
                reject(err);
            });
            this.ws.on("close", () => {
                this.logger.info(`[SIGNAL] Disconnected from signaling server.`);
            });
        });
    }
    send(msg) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(msg));
        }
        else {
            this.logger.warn(`[SIGNAL] Cannot send message, not connected: ${msg.type}`);
        }
    }
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
