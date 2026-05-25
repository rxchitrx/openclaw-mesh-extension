export class SignalingClient {
    ws = null;
    logger;
    localNodeName;
    serverUrl = "";
    isIntentionalDisconnect = false;
    reconnectAttempts = 0;
    reconnectTimer = null;
    onPeerJoin;
    onPeerLeave;
    onSignalMessage;
    constructor(localNodeName, logger) {
        this.localNodeName = localNodeName;
        this.logger = logger;
    }
    async connect(serverUrl) {
        this.serverUrl = serverUrl;
        this.isIntentionalDisconnect = false;
        return this.doConnect();
    }
    async doConnect() {
        const wsModule = await import("ws");
        return new Promise((resolve, reject) => {
            this.ws = new wsModule.default(this.serverUrl);
            this.ws.on("open", () => {
                this.logger.info(`[SIGNAL] Connected to signaling server at ${this.serverUrl}`);
                this.reconnectAttempts = 0;
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
                if (this.reconnectAttempts === 0)
                    reject(err);
            });
            this.ws.on("close", () => {
                this.logger.info(`[SIGNAL] Disconnected from signaling server.`);
                this.ws = null;
                this.scheduleReconnect();
            });
        });
    }
    scheduleReconnect() {
        if (this.isIntentionalDisconnect)
            return;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        this.logger.info(`[SIGNAL] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
        this.reconnectTimer = setTimeout(() => {
            this.doConnect().catch(() => { });
        }, delay);
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
        this.isIntentionalDisconnect = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
