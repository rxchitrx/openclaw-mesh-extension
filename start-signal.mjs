import { SignalingServer } from "./dist/src/signaling/signaling-server.js";

const logger = console;

new SignalingServer(8080, logger);

console.log("[SIGNAL] Server running on port 8080");
