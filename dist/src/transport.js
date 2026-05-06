export function createTransport(config) {
    const { nodeName, port, crdt, logger } = config;
    const connections = new Map();
    let server = null;
    const handleMessage = (peerName, data) => {
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case "delta":
                    crdt.applyRemoteDelta(message.delta, message.file);
                    break;
                case "sync_request": {
                    const state = crdt.getState(message.file);
                    sendToPeer(peerName, {
                        type: "sync_response",
                        file: message.file,
                        state,
                    });
                    break;
                }
                case "sync_response":
                    crdt.mergeState(message.state, message.file);
                    break;
                default:
                    logger.warn(`Unknown message type from ${peerName}: ${message.type}`);
            }
        }
        catch (err) {
            logger.error(`Failed to handle message from ${peerName}: ${err}`);
        }
    };
    const sendToPeer = (peerName, message) => {
        const conn = connections.get(peerName);
        if (conn && conn.socket.readyState === 1) {
            conn.socket.send(JSON.stringify(message));
        }
    };
    return {
        async start() {
            try {
                const { WebSocketServer } = await import("ws");
                server = new WebSocketServer({ port });
                server.on("connection", (socket, req) => {
                    const peerName = req.headers["x-mesh-node"] || "unknown";
                    logger.info(`Incoming connection from: ${peerName}`);
                    const conn = {
                        peerName,
                        socket,
                        isAlive: true,
                    };
                    connections.set(conn.peerName, conn);
                    socket.on("message", (data) => {
                        handleMessage(conn.peerName, data.toString());
                    });
                    socket.on("close", () => {
                        connections.delete(conn.peerName);
                        logger.info(`Peer disconnected: ${conn.peerName} (${connections.size} remaining)`);
                    });
                    socket.on("error", (err) => {
                        logger.error(`Connection error with ${conn.peerName}: ${err}`);
                        connections.delete(conn.peerName);
                    });
                });
                logger.info(`Mesh transport server started on port ${port}`);
            }
            catch (err) {
                logger.error(`Failed to start transport server: ${err}`);
                throw err;
            }
        },
        async stop() {
            for (const [, conn] of connections) {
                conn.socket.close();
            }
            connections.clear();
            if (server) {
                await new Promise((resolve) => {
                    server.close(() => {
                        logger.info("Transport server stopped");
                        resolve();
                    });
                });
            }
        },
        async connectToPeer(peer) {
            if (connections.has(peer.name)) {
                return true;
            }
            try {
                const wsModule = await import("ws");
                const ws = new wsModule.default(`ws://${peer.host}:${peer.port}`, {
                    headers: {
                        "x-mesh-node": nodeName,
                    },
                });
                await new Promise((resolve, reject) => {
                    ws.on("open", () => {
                        const conn = {
                            peerName: peer.name,
                            socket: ws,
                            isAlive: true,
                        };
                        connections.set(peer.name, conn);
                        logger.info(`Connected to peer: ${peer.name} at ${peer.host}:${peer.port}`);
                        resolve();
                    });
                    ws.on("error", (err) => {
                        logger.error(`Failed to connect to ${peer.name}: ${err}`);
                        reject(err);
                    });
                });
                ws.on("message", (data) => {
                    handleMessage(peer.name, data.toString());
                });
                ws.on("close", () => {
                    connections.delete(peer.name);
                    logger.info(`Disconnected from peer: ${peer.name} (${connections.size} remaining)`);
                });
                return true;
            }
            catch (err) {
                logger.error(`Connection to ${peer.name} failed: ${err}`);
                return false;
            }
        },
        broadcast(message) {
            const data = JSON.stringify(message);
            for (const [, conn] of connections) {
                if (conn.socket.readyState === 1) {
                    conn.socket.send(data);
                }
            }
            logger.debug(`Broadcast to ${connections.size} peers`);
        },
        getConnections() {
            return Array.from(connections.keys());
        },
        async maintainConnections() {
            for (const [name, conn] of connections) {
                if (conn.socket.readyState === 3) {
                    connections.delete(name);
                    logger.info(`Removed dead connection: ${name}`);
                }
            }
        },
    };
}
