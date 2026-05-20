export class WebSocketTransport {
    socket;
    type = "lan";
    messageHandlers = [];
    disconnectHandlers = [];
    errorHandlers = [];
    constructor(socket) {
        this.socket = socket;
        this.setupListeners();
    }
    setupListeners() {
        this.socket.on("message", (data) => {
            // Handle both string and buffer inputs seamlessly
            const message = typeof data === "string" ? data : data.toString("utf-8");
            for (const handler of this.messageHandlers) {
                handler(message);
            }
        });
        this.socket.on("close", () => {
            for (const handler of this.disconnectHandlers) {
                handler();
            }
        });
        this.socket.on("error", (err) => {
            for (const handler of this.errorHandlers) {
                handler(err);
            }
        });
    }
    send(message) {
        if (this.isOpen()) {
            this.socket.send(message);
        }
    }
    isOpen() {
        return this.socket && this.socket.readyState === 1; // 1 === OPEN
    }
    close() {
        if (this.socket) {
            this.socket.close();
        }
    }
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }
    onDisconnect(handler) {
        this.disconnectHandlers.push(handler);
    }
    onError(handler) {
        this.errorHandlers.push(handler);
    }
    getRawSocket() {
        return this.socket;
    }
}
