export function createTransport(config) {
    const { nodeName, port, crdt, logger } = config;
    const connections = new Map();
    const pendingConnections = new Map();
    const remoteManifests = new Map();
    const approvedPeers = new Set();
    let server = null;
    let notificationHandler = null;
    const notify = (notification) => {
        if (notificationHandler) {
            notificationHandler(notification);
        }
    };
    const handleMessage = (peerName, data, approved) => {
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case "delta":
                    if (!approved)
                        return;
                    crdt.applyRemoteDelta(message.delta, message.file);
                    break;
                case "sync_request":
                    if (!approved)
                        return;
                    {
                        const state = crdt.getState(message.file);
                        sendToPeer(peerName, {
                            type: "sync_response",
                            file: message.file,
                            state,
                        });
                    }
                    break;
                case "sync_response":
                    if (!approved)
                        return;
                    crdt.mergeState(message.state, message.file);
                    break;
                case "approval_request":
                    {
                        const pending = pendingConnections.get(peerName);
                        if (pending) {
                            logger.info(`Approval request from: ${peerName}`);
                            notify({
                                type: "peer_pending",
                                message: `Peer '${peerName}' wants to join the mesh. Say 'approve ${peerName}' or 'deny ${peerName}'.`,
                                peerName,
                            });
                        }
                    }
                    break;
                case "approval_response":
                    if (message.approved) {
                        const pending = pendingConnections.get(peerName);
                        if (pending) {
                            pendingConnections.delete(peerName);
                            const conn = {
                                peerName,
                                socket: pending.socket,
                                isAlive: true,
                                approved: true,
                            };
                            connections.set(peerName, conn);
                            approvedPeers.add(peerName);
                            notify({
                                type: "peer_approved",
                                message: `Peer '${peerName}' approved your connection request.`,
                                peerName,
                            });
                        }
                    }
                    else {
                        const pending = pendingConnections.get(peerName);
                        if (pending) {
                            pending.socket.close();
                            pendingConnections.delete(peerName);
                            notify({
                                type: "peer_denied",
                                message: `Peer '${peerName}' denied your connection request.`,
                                peerName,
                            });
                        }
                    }
                    break;
                case "manifest":
                    if (!approved)
                        return;
                    remoteManifests.set(peerName, message.files);
                    notify({
                        type: "manifest_received",
                        message: `Received manifest from '${peerName}' (${message.files.length} files).`,
                        peerName,
                        data: message.files,
                    });
                    break;
                case "manifest_request":
                    if (!approved)
                        return;
                    {
                        const manifestCb = message._manifestCallback;
                        if (manifestCb)
                            manifestCb();
                    }
                    break;
                case "file_content":
                    if (!approved)
                        return;
                    {
                        const { path: filePath, content, isBinary } = message;
                        if (isBinary) {
                            crdt.applyLocalChange(filePath, content);
                            logger.info(`Received binary file: ${filePath} from ${peerName}`);
                        }
                        else {
                            const delta = crdt.applyLocalChange(filePath, content);
                            if (delta) {
                                const localContent = crdt.getFileContent(filePath);
                                if (localContent !== null && localContent !== content) {
                                    notify({
                                        type: "conflict",
                                        message: `Conflict: both you and '${peerName}' edited '${filePath}'. CRDT merged — you may want to review.`,
                                        peerName,
                                        data: { file: filePath },
                                    });
                                }
                            }
                            logger.info(`Received file: ${filePath} from ${peerName}`);
                        }
                    }
                    break;
                case "file_content_request":
                    if (!approved)
                        return;
                    {
                        const manifestCb2 = message._contentCallback;
                        if (manifestCb2)
                            manifestCb2(message.path);
                    }
                    break;
                case "file_deleted":
                    if (!approved)
                        return;
                    notify({
                        type: "file_deleted",
                        message: `Peer '${peerName}' deleted '${message.path}'. Keep your copy or say 'delete ${message.path} locally'.`,
                        peerName,
                        data: { path: message.path },
                    });
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
    const setupSocket = (socket, peerName, isIncoming) => {
        socket.on("message", (data) => {
            const pending = pendingConnections.get(peerName);
            if (pending) {
                handleMessage(peerName, data.toString(), false);
            }
            else {
                const conn = connections.get(peerName);
                if (conn && conn.approved) {
                    handleMessage(peerName, data.toString(), true);
                }
            }
        });
        socket.on("close", () => {
            pendingConnections.delete(peerName);
            if (connections.has(peerName)) {
                connections.delete(peerName);
                notify({
                    type: "peer_disconnected",
                    message: `Peer '${peerName}' disconnected (${connections.size} remaining).`,
                    peerName,
                });
            }
            logger.info(`Peer disconnected: ${peerName} (${connections.size} remaining)`);
        });
        socket.on("error", (err) => {
            logger.error(`Connection error with ${peerName}: ${err}`);
            pendingConnections.delete(peerName);
            connections.delete(peerName);
        });
    };
    return {
        async start() {
            try {
                const { WebSocketServer } = await import("ws");
                server = new WebSocketServer({ port });
                server.on("connection", (socket, req) => {
                    const peerName = req.headers["x-mesh-node"] || "unknown";
                    const host = req.socket.remoteAddress || "unknown";
                    logger.info(`Incoming connection from: ${peerName} at ${host}`);
                    const alreadyApproved = approvedPeers.has(peerName);
                    const alreadyConnected = connections.has(peerName);
                    if (alreadyConnected) {
                        const old = connections.get(peerName);
                        old.socket.close();
                        connections.delete(peerName);
                    }
                    if (alreadyApproved) {
                        const conn = {
                            peerName,
                            socket,
                            isAlive: true,
                            approved: true,
                        };
                        connections.set(peerName, conn);
                        setupSocket(socket, peerName, true);
                        logger.info(`Auto-approved reconnection from: ${peerName}`);
                    }
                    else {
                        const pending = {
                            peerName,
                            socket,
                            host,
                            connectedAt: Date.now(),
                        };
                        pendingConnections.set(peerName, pending);
                        setupSocket(socket, peerName, true);
                        socket.send(JSON.stringify({
                            type: "approval_request",
                            node: nodeName,
                        }));
                        notify({
                            type: "peer_pending",
                            message: `Peer '${peerName}' from ${host} wants to join the mesh. Say 'approve ${peerName}' or 'deny ${peerName}'.`,
                            peerName,
                        });
                    }
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
            for (const [, pending] of pendingConnections) {
                pending.socket.close();
            }
            pendingConnections.clear();
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
            if (connections.has(peer.name))
                return true;
            if (pendingConnections.has(peer.name))
                return true;
            try {
                const wsModule = await import("ws");
                const ws = new wsModule.default(`ws://${peer.host}:${peer.port}`, {
                    headers: {
                        "x-mesh-node": nodeName,
                    },
                });
                await new Promise((resolve, reject) => {
                    ws.on("open", () => {
                        const alreadyApproved = approvedPeers.has(peer.name);
                        if (alreadyApproved) {
                            const conn = {
                                peerName: peer.name,
                                socket: ws,
                                isAlive: true,
                                approved: true,
                            };
                            connections.set(peer.name, conn);
                            setupSocket(ws, peer.name, false);
                            logger.info(`Connected to approved peer: ${peer.name} at ${peer.host}:${peer.port}`);
                        }
                        else {
                            const pending = {
                                peerName: peer.name,
                                socket: ws,
                                host: peer.host,
                                connectedAt: Date.now(),
                            };
                            pendingConnections.set(peer.name, pending);
                            setupSocket(ws, peer.name, false);
                            logger.info(`Connected to peer (awaiting approval): ${peer.name} at ${peer.host}:${peer.port}`);
                        }
                        resolve();
                    });
                    ws.on("error", (err) => {
                        logger.error(`Failed to connect to ${peer.name}: ${err}`);
                        reject(err);
                    });
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
            let sent = 0;
            for (const [, conn] of connections) {
                if (conn.approved && conn.socket.readyState === 1) {
                    conn.socket.send(data);
                    sent++;
                }
            }
            logger.debug(`Broadcast to ${sent} approved peers`);
        },
        sendToPeer,
        getConnections() {
            return Array.from(connections.keys());
        },
        getPendingConnections() {
            return Array.from(pendingConnections.values());
        },
        approveConnection(peerName) {
            const pending = pendingConnections.get(peerName);
            if (!pending)
                return false;
            pendingConnections.delete(peerName);
            const conn = {
                peerName,
                socket: pending.socket,
                isAlive: true,
                approved: true,
            };
            connections.set(peerName, conn);
            approvedPeers.add(peerName);
            sendToPeer(peerName, {
                type: "approval_response",
                approved: true,
                node: nodeName,
            });
            logger.info(`Approved peer: ${peerName}`);
            notify({
                type: "peer_approved",
                message: `Approved peer '${peerName}'. Manifest will be exchanged.`,
                peerName,
            });
            return true;
        },
        denyConnection(peerName) {
            const pending = pendingConnections.get(peerName);
            if (!pending)
                return false;
            sendToPeer(peerName, {
                type: "approval_response",
                approved: false,
                node: nodeName,
            });
            pending.socket.close();
            pendingConnections.delete(peerName);
            logger.info(`Denied peer: ${peerName}`);
            notify({
                type: "peer_denied",
                message: `Denied peer '${peerName}'.`,
                peerName,
            });
            return true;
        },
        getRemoteManifest(peerName) {
            return remoteManifests.get(peerName) || null;
        },
        requestManifest(peerName) {
            sendToPeer(peerName, { type: "manifest_request" });
        },
        sendFileContent(peerName, relativePath, content, isBinary) {
            sendToPeer(peerName, {
                type: "file_content",
                path: relativePath,
                content,
                isBinary,
                from: nodeName,
            });
        },
        requestFileContent(peerName, relativePath) {
            sendToPeer(peerName, {
                type: "file_content_request",
                path: relativePath,
                from: nodeName,
            });
        },
        sendLocalManifest(peerName, manifest) {
            sendToPeer(peerName, {
                type: "manifest",
                files: manifest,
                from: nodeName,
            });
        },
        notifyFileDeleted(relativePath) {
            const msg = { type: "file_deleted", path: relativePath, from: nodeName };
            const data = JSON.stringify(msg);
            for (const [, conn] of connections) {
                if (conn.approved && conn.socket.readyState === 1) {
                    conn.socket.send(data);
                }
            }
        },
        setNotificationHandler(handler) {
            notificationHandler = handler;
        },
        async maintainConnections() {
            for (const [name, conn] of connections) {
                if (conn.socket.readyState === 3) {
                    connections.delete(name);
                    notify({
                        type: "peer_disconnected",
                        message: `Peer '${name}' disconnected (${connections.size} remaining).`,
                        peerName: name,
                    });
                }
            }
        },
    };
}
