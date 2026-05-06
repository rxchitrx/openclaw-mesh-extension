export function createTransport(config) {
    const { nodeName, port, crdt, logger } = config;
    const connections = new Map();
    const pendingConnections = new Map();
    const remoteManifests = new Map();
    const approvedPeers = new Set();
    const remoteNodeInfo = new Map();
    let nodeInfoProvider = null;
    let fileContentProvider = null;
    let manifestProvider = null;
    let fileWriter = null;
    let server = null;
    let notificationHandler = null;
    let keepaliveTimer = null;
    const PING_INTERVAL_MS = 30000;
    const notify = (notification) => {
        if (notificationHandler) {
            notificationHandler(notification);
        }
    };
    const handleMessage = async (peerName, data, approved) => {
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
                                message: `Peer '${peerName}' wants to join the mesh. Ask the user if they want to approve or deny this connection. Do NOT approve or deny on your own — wait for the user's decision.`,
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
                            sendNodeInfoToPeer(peerName);
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
                case "node_info":
                    if (!approved)
                        return;
                    {
                        const info = {
                            nodeName: message.nodeName,
                            trackingDir: message.trackingDir,
                            trackingFileCount: message.trackingFileCount,
                            trackingFiles: message.trackingFiles || [],
                        };
                        remoteNodeInfo.set(peerName, info);
                        const dirStr = info.trackingDir ? info.trackingDir : "none";
                        const fileStr = info.trackingFileCount > 0 ? `${info.trackingFileCount} file(s)` : "no files";
                        notify({
                            type: "node_info_received",
                            message: `Peer '${peerName}' info — tracking: ${dirStr} (${fileStr})`,
                            peerName,
                            data: info,
                        });
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
                        if (manifestProvider) {
                            const localManifest = manifestProvider();
                            sendToPeer(peerName, {
                                type: "manifest",
                                files: localManifest,
                                from: nodeName,
                            });
                            logger.info(`Sent manifest to ${peerName} (${localManifest.length} files)`);
                        }
                    }
                    break;
                case "file_content":
                    if (!approved)
                        return;
                    {
                        const { path: filePath, content, isBinary } = message;
                        if (isBinary) {
                            crdt.applyRemoteBinary(filePath, content);
                        }
                        else {
                            crdt.applyRemoteDelta({ file: filePath, changes: [{ type: "replace", content }], timestamp: Date.now(), author: message.from || peerName, isBinary: false }, filePath);
                        }
                        if (fileWriter) {
                            try {
                                await fileWriter(filePath, content, isBinary);
                                logger.info(`Wrote received file to disk: ${filePath} from ${peerName}`);
                            }
                            catch (err) {
                                logger.error(`Failed to write received file ${filePath}: ${err}`);
                            }
                        }
                        else {
                            logger.info(`Received file (no writer): ${filePath} from ${peerName}`);
                        }
                        notify({
                            type: "file_content",
                            message: `Received '${filePath}' from '${peerName}' (${content.length} chars, ${isBinary ? "binary" : "text"}). Written to disk.`,
                            peerName,
                            data: { file: filePath },
                        });
                    }
                    break;
                case "file_content_request":
                    if (!approved)
                        return;
                    {
                        if (fileContentProvider) {
                            const fileData = await fileContentProvider(message.path);
                            if (fileData) {
                                sendToPeer(peerName, {
                                    type: "file_content",
                                    path: message.path,
                                    content: fileData.content,
                                    isBinary: fileData.isBinary,
                                    from: nodeName,
                                });
                                logger.info(`Sent requested file ${message.path} to ${peerName}`);
                            }
                            else {
                                logger.warn(`Requested file not found: ${message.path}`);
                            }
                        }
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
    const sendNodeInfoToPeer = (peerName) => {
        if (nodeInfoProvider) {
            const info = nodeInfoProvider();
            sendToPeer(peerName, {
                type: "node_info",
                nodeName: info.nodeName,
                trackingDir: info.trackingDir,
                trackingFileCount: info.trackingFileCount,
                trackingFiles: info.trackingFiles,
            });
            logger.info(`Sent node_info to ${peerName}`);
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
            const raw = data.toString();
            if (raw === "__ping__") {
                if (socket.readyState === 1)
                    socket.send("__pong__");
                return;
            }
            if (raw === "__pong__") {
                const conn = connections.get(peerName);
                if (conn)
                    conn.isAlive = true;
                return;
            }
            const pending = pendingConnections.get(peerName);
            if (pending) {
                handleMessage(peerName, raw, false);
            }
            else {
                const conn = connections.get(peerName);
                if (conn && conn.approved) {
                    handleMessage(peerName, raw, true);
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
                            message: `Peer '${peerName}' from ${host} wants to join the mesh. Ask the user if they want to approve or deny this connection. Do NOT approve or deny on your own — wait for the user's decision.`,
                            peerName,
                        });
                    }
                });
                logger.info(`Mesh transport server started on port ${port}`);
                keepaliveTimer = setInterval(() => {
                    for (const [name, conn] of connections) {
                        if (!conn.isAlive) {
                            logger.warn(`Peer ${name} missed ping, closing connection`);
                            conn.socket.terminate();
                            connections.delete(name);
                            notify({
                                type: "peer_disconnected",
                                message: `Peer '${name}' disconnected (missed ping, ${connections.size} remaining).`,
                                peerName: name,
                            });
                            continue;
                        }
                        conn.isAlive = false;
                        if (conn.socket.readyState === 1) {
                            conn.socket.send("__ping__");
                        }
                    }
                }, PING_INTERVAL_MS);
            }
            catch (err) {
                logger.error(`Failed to start transport server: ${err}`);
                throw err;
            }
        },
        async stop() {
            if (keepaliveTimer) {
                clearInterval(keepaliveTimer);
                keepaliveTimer = null;
            }
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
                message: `Approved peer '${peerName}'. Info will be exchanged.`,
                peerName,
            });
            sendNodeInfoToPeer(peerName);
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
        getNodeInfo(peerName) {
            return remoteNodeInfo.get(peerName) || null;
        },
        setNodeInfoProvider(provider) {
            nodeInfoProvider = provider;
        },
        setFileContentProvider(provider) {
            fileContentProvider = provider;
        },
        setManifestProvider(provider) {
            manifestProvider = provider;
        },
        setFileWriter(writer) {
            fileWriter = writer;
        },
    };
}
