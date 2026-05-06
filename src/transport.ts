import type { PluginLogger } from "openclaw/plugin-sdk";
import type { CRDTService } from "./crdt.js";
import type { PeerInfo } from "./discovery.js";

export type TransportConfig = {
  nodeName: string;
  port: number;
  crdt: CRDTService;
  logger: PluginLogger;
};

export type Connection = {
  peerName: string;
  socket: WebSocket;
  isAlive: boolean;
};

export type TransportService = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  connectToPeer: (peer: PeerInfo) => Promise<boolean>;
  broadcast: (message: any) => void;
  getConnections: () => string[];
  maintainConnections: () => Promise<void>;
};

export function createTransport(config: TransportConfig): TransportService {
  const { nodeName, port, crdt, logger } = config;

  const connections = new Map<string, Connection>();
  let server: any = null;

  const handleMessage = (peerName: string, data: string) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "delta":
          // Incoming CRDT delta from peer
          crdt.applyRemoteDelta(message.delta, message.file);
          break;

        case "sync_request":
          // Peer wants our state
          const state = crdt.getState(message.file);
          sendToPeer(peerName, {
            type: "sync_response",
            file: message.file,
            state,
          });
          break;

        case "sync_response":
          // Peer sent their state
          crdt.mergeState(message.state, message.file);
          break;

        default:
          logger.warn(`Unknown message type from ${peerName}: ${message.type}`);
      }
    } catch (err) {
      logger.error(`Failed to handle message from ${peerName}: ${err}`);
    }
  };

  const sendToPeer = (peerName: string, message: any) => {
    const conn = connections.get(peerName);
    if (conn && conn.socket.readyState === 1) {
      // OPEN
      conn.socket.send(JSON.stringify(message));
    }
  };

  return {
    async start() {
      try {
        const { WebSocketServer } = await import("ws");

        server = new WebSocketServer({ port });

        server.on("connection", (socket: WebSocket, req: any) => {
          // Extract peer name from handshake
          const peerName = req.headers["x-mesh-node"] || "unknown";

          logger.info(`Incoming connection from: ${peerName}`);

          const conn: Connection = {
            peerName: peerName as string,
            socket,
            isAlive: true,
          };

          connections.set(conn.peerName, conn);

          socket.on("message", (data: Buffer) => {
            handleMessage(conn.peerName, data.toString());
          });

          socket.on("close", () => {
            connections.delete(conn.peerName);
            logger.info(`Peer disconnected: ${conn.peerName}`);
          });

          socket.on("error", (err) => {
            logger.error(`Connection error with ${conn.peerName}: ${err}`);
            connections.delete(conn.peerName);
          });
        });

        logger.info(`Transport server listening on port ${port}`);
      } catch (err) {
        logger.error(`Failed to start transport server: ${err}`);
        throw err;
      }
    },

    async stop() {
      // Close all connections
      for (const [name, conn] of connections) {
        conn.socket.close();
      }
      connections.clear();

      // Close server
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => {
            logger.info("Transport server stopped");
            resolve();
          });
        });
      }
    },

    async connectToPeer(peer: PeerInfo) {
      if (connections.has(peer.name)) {
        return true; // Already connected
      }

      try {
        const ws = new WebSocket(`ws://${peer.host}:${peer.port}`, {
          headers: {
            "x-mesh-node": nodeName,
          },
        });

        await new Promise<void>((resolve, reject) => {
          ws.on("open", () => {
            const conn: Connection = {
              peerName: peer.name,
              socket: ws,
              isAlive: true,
            };

            connections.set(peer.name, conn);
            logger.info(`Connected to peer: ${peer.name}`);
            resolve();
          });

          ws.on("error", (err) => {
            logger.error(`Failed to connect to ${peer.name}: ${err}`);
            reject(err);
          });
        });

        // Set up message handling
        ws.on("message", (data: Buffer) => {
          handleMessage(peer.name, data.toString());
        });

        ws.on("close", () => {
          connections.delete(peer.name);
          logger.info(`Disconnected from peer: ${peer.name}`);
        });

        return true;
      } catch (err) {
        logger.error(`Connection to ${peer.name} failed: ${err}`);
        return false;
      }
    },

    broadcast(message: any) {
      const data = JSON.stringify(message);

      for (const [name, conn] of connections) {
        if (conn.socket.readyState === 1) {
          // OPEN
          conn.socket.send(data);
        }
      }

      logger.debug(`Broadcast to ${connections.size} peers`);
    },

    getConnections() {
      return Array.from(connections.keys());
    },

    async maintainConnections() {
      // This is called on heartbeat - check for dead connections
      for (const [name, conn] of connections) {
        if (conn.socket.readyState === 3) {
          // CLOSED
          connections.delete(name);
          logger.info(`Removed dead connection: ${name}`);
        }
      }
    },
  };
}
