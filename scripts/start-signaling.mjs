import { SignalingServer } from "../dist/src/signaling/signaling-server.js";

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
};

new SignalingServer(port, logger);
console.log(`\n✅ Signaling Server running on ws://0.0.0.0:${port}`);
console.log(`Ensure port ${port} is open on your firewall/router if testing across networks.\n`);
