import { createServer } from "http";
import { MAX_RAW_MESSAGE_BYTES, isRawMessageTooLarge } from "./protocol-validation.js";
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function send(socket, frame) {
    if (socket.readyState === 1) {
        socket.send(JSON.stringify(frame));
    }
}
export async function startMeshRelayServer(options = {}) {
    const { WebSocketServer } = await import("ws");
    const logger = options.logger ?? console;
    const server = createServer();
    const wss = new WebSocketServer({ server, maxPayload: MAX_RAW_MESSAGE_BYTES + 4096 });
    const peersBySocket = new Map();
    const rooms = new Map();
    const unregister = (socket) => {
        const peer = peersBySocket.get(socket);
        if (!peer)
            return;
        peersBySocket.delete(socket);
        const room = rooms.get(peer.room);
        if (room?.get(peer.nodeName)?.socket === socket) {
            room.delete(peer.nodeName);
            for (const other of room.values()) {
                send(other.socket, { type: "peer_offline", name: peer.nodeName });
            }
            if (room.size === 0)
                rooms.delete(peer.room);
        }
    };
    const register = (socket, message) => {
        if (options.token && message.token !== options.token) {
            send(socket, { type: "error", code: "unauthorized", message: "invalid relay token" });
            socket.close(1008, "unauthorized");
            return;
        }
        const roomName = typeof message.room === "string" ? message.room.trim() : "";
        const nodeName = typeof message.nodeName === "string" ? message.nodeName.trim() : "";
        if (!roomName || !nodeName || roomName.length > 128 || nodeName.length > 128) {
            send(socket, { type: "error", code: "invalid_register", message: "room and nodeName are required" });
            socket.close(1008, "invalid_register");
            return;
        }
        let room = rooms.get(roomName);
        if (!room) {
            room = new Map();
            rooms.set(roomName, room);
        }
        const existing = room.get(nodeName);
        if (existing && existing.socket !== socket) {
            send(existing.socket, { type: "error", code: "duplicate_node", message: "node name connected elsewhere" });
            existing.socket.close(1008, "duplicate_node");
            unregister(existing.socket);
        }
        const peer = {
            nodeName,
            room: roomName,
            fingerprint: typeof message.fingerprint === "string" ? message.fingerprint : undefined,
            publicKey: typeof message.publicKey === "string" ? message.publicKey : undefined,
            socket,
        };
        room.set(nodeName, peer);
        peersBySocket.set(socket, peer);
        const peers = Array.from(room.values())
            .filter((item) => item.nodeName !== nodeName)
            .map((item) => ({ name: item.nodeName, fingerprint: item.fingerprint, publicKey: item.publicKey }));
        send(socket, { type: "registered", room: roomName, peers });
        for (const other of room.values()) {
            if (other.nodeName === nodeName)
                continue;
            send(other.socket, {
                type: "peer_online",
                name: nodeName,
                fingerprint: peer.fingerprint,
                publicKey: peer.publicKey,
            });
        }
    };
    const forward = (socket, message) => {
        const sender = peersBySocket.get(socket);
        if (!sender) {
            send(socket, { type: "error", code: "not_registered", message: "register before sending messages" });
            return;
        }
        const to = typeof message.to === "string" ? message.to : "";
        const payload = typeof message.payload === "string" ? message.payload : "";
        if (!to || !payload) {
            send(socket, { type: "error", code: "invalid_message", message: "to and payload are required" });
            return;
        }
        if (Buffer.byteLength(payload, "utf-8") > MAX_RAW_MESSAGE_BYTES) {
            send(socket, { type: "error", code: "payload_too_large", message: "payload exceeds relay limit" });
            return;
        }
        const target = rooms.get(sender.room)?.get(to);
        if (!target) {
            send(socket, { type: "error", code: "peer_offline", message: `peer '${to}' is not online` });
            return;
        }
        send(target.socket, { type: "relay_message", from: sender.nodeName, payload });
    };
    wss.on("connection", (socket) => {
        socket.on("message", (data) => {
            if (isRawMessageTooLarge(data.length)) {
                send(socket, { type: "error", code: "payload_too_large", message: "frame exceeds relay limit" });
                socket.close(1009, "payload_too_large");
                return;
            }
            let message;
            try {
                message = JSON.parse(data.toString("utf-8"));
            }
            catch {
                send(socket, { type: "error", code: "invalid_json", message: "frame must be JSON" });
                return;
            }
            if (!isRecord(message) || typeof message.type !== "string") {
                send(socket, { type: "error", code: "invalid_frame", message: "frame type is required" });
                return;
            }
            if (message.type === "register") {
                register(socket, message);
            }
            else if (message.type === "relay_message") {
                forward(socket, message);
            }
            else {
                send(socket, { type: "error", code: "unknown_type", message: "unknown relay frame type" });
            }
        });
        socket.on("close", () => unregister(socket));
        socket.on("error", (err) => logger.warn?.(`Relay socket error: ${err.message}`));
    });
    await new Promise((resolve) => server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : options.port ?? 0;
    logger.info?.(`OpenClaw mesh relay listening on ${options.host ?? "127.0.0.1"}:${port}`);
    return {
        port,
        server,
        close: async () => {
            for (const peer of peersBySocket.values()) {
                try {
                    peer.socket.close();
                }
                catch { }
            }
            await new Promise((resolve) => wss.close(() => resolve()));
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
