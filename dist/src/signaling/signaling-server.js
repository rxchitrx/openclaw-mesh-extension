import { WebSocketServer, WebSocket } from "ws";
export class SignalingServer {
    wss;
    peers = new Map();
    logger;
    constructor(port, logger) {
        this.logger = logger;
        this.wss = new WebSocketServer({ port, host: "::", maxPayload: 65536 });
        this.wss.on("connection", (ws) => {
            let registeredPeerName = null;
            ws.on("message", (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    switch (msg.type) {
                        case "register":
                            if (this.peers.has(msg.from)) {
                                const existingWs = this.peers.get(msg.from);
                                if (existingWs.readyState === WebSocket.OPEN && existingWs !== ws) {
                                    this.logger.warn(`[SIGNAL][WARN] Duplicate registration rejected for ${msg.from}`);
                                    return;
                                }
                            }
                            registeredPeerName = msg.from;
                            this.peers.set(registeredPeerName, ws);
                            this.logger.info(`[SIGNAL] Peer joined: ${registeredPeerName}`);
                            // Broadcast join to all other peers
                            this.broadcast({
                                type: "peer_join",
                                from: registeredPeerName
                            }, registeredPeerName);
                            // Send the new peer the list of already connected peers
                            for (const [existingPeerName, existingWs] of this.peers) {
                                if (existingPeerName !== registeredPeerName && existingWs.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({ type: "peer_join", from: existingPeerName }));
                                }
                            }
                            break;
                        case "signal_offer":
                        case "signal_answer":
                        case "ice_candidate":
                            if (!registeredPeerName || msg.from !== registeredPeerName) {
                                this.logger.warn(`[SIGNAL] Rejected message with spoofed 'from' field: expected ${registeredPeerName}, got ${msg.from}`);
                                return;
                            }
                            msg.from = registeredPeerName;
                            this.logger.info(`[SIGNAL] Relaying ${msg.type} from ${msg.from} to ${msg.target}`);
                            this.relay(msg);
                            break;
                    }
                }
                catch (err) {
                    this.logger.error(`[SIGNAL] Invalid message format: ${err}`);
                }
            });
            ws.on("close", () => {
                if (registeredPeerName) {
                    if (this.peers.get(registeredPeerName) === ws) {
                        this.peers.delete(registeredPeerName);
                        this.logger.info(`[SIGNAL] Peer disconnected: ${registeredPeerName}`);
                        // Broadcast leave to all other peers
                        this.broadcast({
                            type: "peer_leave",
                            from: registeredPeerName
                        });
                    }
                }
            });
        });
        this.logger.info(`[SIGNAL] Signaling server started on port ${port}`);
    }
    relay(msg) {
        if (msg.target && this.peers.has(msg.target)) {
            const targetWs = this.peers.get(msg.target);
            if (targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify(msg));
            }
        }
    }
    broadcast(msg, excludePeer) {
        const data = JSON.stringify(msg);
        for (const [peerName, ws] of this.peers) {
            if (peerName !== excludePeer && ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        }
    }
    close() {
        this.wss.close();
    }
}
