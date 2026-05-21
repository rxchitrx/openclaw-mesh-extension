import { WebSocketServer, WebSocket } from "ws";
export class SignalingServer {
    wss;
    peers = new Map();
    logger;
    constructor(port, logger) {
        this.logger = logger;
        this.wss = new WebSocketServer({ port });
        this.wss.on("connection", (ws) => {
            let registeredPeerName = null;
            ws.on("message", (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    switch (msg.type) {
                        case "register":
                            registeredPeerName = msg.from;
                            this.peers.set(registeredPeerName, ws);
                            this.logger.info(`[SIGNAL] Peer joined: ${registeredPeerName}`);
                            // Broadcast join to all other peers
                            this.broadcast({
                                type: "peer_join",
                                from: registeredPeerName
                            }, registeredPeerName);
                            break;
                        case "signal_offer":
                            this.logger.info(`[SIGNAL] Relaying offer from ${msg.from} to ${msg.target}`);
                            this.relay(msg);
                            break;
                        case "signal_answer":
                            this.logger.info(`[SIGNAL] Relaying answer from ${msg.from} to ${msg.target}`);
                            this.relay(msg);
                            break;
                        case "ice_candidate":
                            this.logger.info(`[SIGNAL] Relaying ICE candidate from ${msg.from} to ${msg.target}`);
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
                    this.peers.delete(registeredPeerName);
                    this.logger.info(`[SIGNAL] Peer disconnected: ${registeredPeerName}`);
                    // Broadcast leave to all other peers
                    this.broadcast({
                        type: "peer_leave",
                        from: registeredPeerName
                    });
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
