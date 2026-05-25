import { startMeshRelayServer } from "./src/relay-server.js";
const port = Number(process.env.PORT || process.argv[2] || 18791);
const host = process.env.HOST || "0.0.0.0";
const token = process.env.OPENCLAW_MESH_RELAY_TOKEN;
await startMeshRelayServer({ port, host, token, logger: console });
