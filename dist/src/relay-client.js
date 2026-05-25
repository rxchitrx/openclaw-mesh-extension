import { EventEmitter } from "events";
import { encodePublicKeyForWire } from "./peer-identity.js";
import { isRawMessageTooLarge, MAX_RAW_MESSAGE_BYTES } from "./protocol-validation.js";
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
export class RelayClient {
    config;
    ws = null;
    connected = false;
    stopping = false;
    reconnectTimer = null;
    emitter = new EventEmitter();
    constructor(config) {
        this.config = config;
    }
    on(event, handler) {
        this.emitter.on(event, handler);
    }
    async start() {
        this.stopping = false;
        await this.open();
    }
    async stop() {
        this.stopping = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            try {
                if (typeof this.ws.terminate === "function") {
                    this.ws.terminate();
                }
                else {
                    this.ws.close();
                }
            }
            catch { }
            this.ws = null;
        }
        this.connected = false;
    }
    isConnected() {
        return this.connected;
    }
    send(to, payload) {
        if (!this.ws || this.ws.readyState !== 1 || !this.connected)
            return false;
        const data = JSON.stringify({ type: "relay_message", to, payload });
        if (Buffer.byteLength(data, "utf-8") > MAX_RAW_MESSAGE_BYTES + 4096) {
            this.config.logger.warn?.(`Refusing oversized relay message to ${to}`);
            return false;
        }
        this.ws.send(data);
        return true;
    }
    async open() {
        const { default: WebSocket } = await import("ws");
        const ws = new WebSocket(this.config.url);
        this.ws = ws;
        ws.on("open", () => {
            ws.send(JSON.stringify({
                type: "register",
                room: this.config.room,
                token: this.config.token,
                nodeName: this.config.nodeName,
                fingerprint: this.config.identity.fingerprint,
                publicKey: encodePublicKeyForWire(this.config.identity.publicKey),
            }));
        });
        ws.on("message", (data) => {
            if (isRawMessageTooLarge(data.length)) {
                this.config.logger.warn?.(`Ignoring oversized relay frame: ${data.length} bytes`);
                return;
            }
            this.handleFrame(data.toString("utf-8"));
        });
        ws.on("close", () => {
            this.connected = false;
            this.emitter.emit("status", "disconnected");
            this.scheduleReconnect();
        });
        ws.on("error", (err) => {
            this.config.logger.error?.(`Relay connection error: ${err.message}`);
            this.emitter.emit("status", "error", err.message);
        });
    }
    handleFrame(raw) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            this.config.logger.warn?.("Ignoring invalid relay JSON frame");
            return;
        }
        if (!isRecord(parsed) || typeof parsed.type !== "string")
            return;
        if (parsed.type === "registered") {
            this.connected = true;
            this.emitter.emit("status", "connected");
            if (Array.isArray(parsed.peers)) {
                for (const item of parsed.peers) {
                    if (!isRecord(item) || typeof item.name !== "string" || item.name === this.config.nodeName)
                        continue;
                    this.emitter.emit("peer", {
                        name: item.name,
                        fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : undefined,
                        publicKey: typeof item.publicKey === "string" ? item.publicKey : undefined,
                        lastSeen: Date.now(),
                    });
                }
            }
            return;
        }
        if (parsed.type === "peer_online" && typeof parsed.name === "string" && parsed.name !== this.config.nodeName) {
            this.emitter.emit("peer", {
                name: parsed.name,
                fingerprint: typeof parsed.fingerprint === "string" ? parsed.fingerprint : undefined,
                publicKey: typeof parsed.publicKey === "string" ? parsed.publicKey : undefined,
                lastSeen: Date.now(),
            });
            return;
        }
        if (parsed.type === "peer_offline" && typeof parsed.name === "string") {
            this.emitter.emit("peerGone", parsed.name);
            return;
        }
        if (parsed.type === "relay_message" && typeof parsed.from === "string" && typeof parsed.payload === "string") {
            this.emitter.emit("message", { from: parsed.from, payload: parsed.payload });
            return;
        }
        if (parsed.type === "error") {
            this.config.logger.warn?.(`Relay error: ${typeof parsed.message === "string" ? parsed.message : "unknown"}`);
        }
    }
    scheduleReconnect() {
        if (this.stopping || this.reconnectTimer)
            return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.stopping) {
                void this.open().catch((err) => {
                    this.config.logger.error?.(`Relay reconnect failed: ${err}`);
                    this.scheduleReconnect();
                });
            }
        }, 3000);
    }
}
