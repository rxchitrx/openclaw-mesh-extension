import type { PluginLogger } from "openclaw/plugin-sdk";

export type PeerInfo = {
  name: string;
  host: string;
  port: number;
  lastSeen: number;
};

export type DiscoveryConfig = {
  nodeName: string;
  port: number;
  logger: PluginLogger;
};

export type DiscoveryService = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  scan: () => Promise<void>;
  getPeers: () => PeerInfo[];
  getLocalNode: () => { name: string; host: string; port: number };
};

// mDNS service type for OpenClaw mesh
const MESH_SERVICE_TYPE = "_openclaw-mesh._tcp";

export function createDiscovery(config: DiscoveryConfig): DiscoveryService {
  const { nodeName, port, logger } = config;
  const peers = new Map<string, PeerInfo>();

  let mdnsServer: any = null;
  let localHost = "0.0.0.0";

  const getLocalIP = (): string => {
    const os = require("os");
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        // Skip internal and non-IPv4 addresses
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
    return "127.0.0.1";
  };

  return {
    async start() {
      localHost = getLocalIP();

      try {
        // Dynamic import for ESM compatibility
        const { Advertisement, Browser } = await import("@homebridge/ciao");

        // Advertise ourselves
        mdnsServer = new Advertisement(MESH_SERVICE_TYPE, port, {
          name: nodeName,
          txt: {
            node: nodeName,
            version: "1.0.0",
          },
        });

        await mdnsServer.start();
        logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        logger.info(`📍 MESH DISCOVERY STARTED`);
        logger.info(`   Node Name: ${nodeName}`);
        logger.info(`   Local Host: ${localHost}`);
        logger.info(`   Port: ${port}`);
        logger.info(`   Service Type: ${MESH_SERVICE_TYPE}`);
        logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        // Browse for other nodes
        const browser = new Browser(MESH_SERVICE_TYPE);

        browser.on("serviceUp", (service: any) => {
          if (service.name === nodeName) return; // Skip self

          const peer: PeerInfo = {
            name: service.name,
            host: service.host || service.addresses?.[0] || "unknown",
            port: service.port,
            lastSeen: Date.now(),
          };

          peers.set(peer.name, peer);
          logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          logger.info(`✅ PEER DISCOVERED`);
          logger.info(`   Name: ${peer.name}`);
          logger.info(`   Host: ${peer.host}`);
          logger.info(`   Port: ${peer.port}`);
          logger.info(`   Total Peers: ${peers.size}`);
          logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        });

        browser.on("serviceDown", (service: any) => {
          if (peers.has(service.name)) {
            peers.delete(service.name);
            logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            logger.info(`❌ PEER LEFT`);
            logger.info(`   Name: ${service.name}`);
            logger.info(`   Remaining Peers: ${peers.size}`);
            logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          }
        });

        await browser.start();
      } catch (err) {
        logger.error(`Failed to start mDNS discovery: ${err}`);
        logger.warn("Mesh will run in standalone mode (no peer discovery)");
      }
    },

    async stop() {
      if (mdnsServer) {
        try {
          await mdnsServer.stop();
          logger.info("Mesh discovery stopped");
        } catch (err) {
          logger.error(`Error stopping discovery: ${err}`);
        }
      }
    },

    async scan() {
      // mDNS is continuous - this is just a heartbeat hook
      // Clean up stale peers (not seen in 60s)
      const now = Date.now();
      let staleCount = 0;
      for (const [name, peer] of peers) {
        if (now - peer.lastSeen > 60000) {
          peers.delete(name);
          staleCount++;
          logger.warn(`⏰ STALE PEER REMOVED: ${name} (last seen ${Math.floor((now - peer.lastSeen)/1000)}s ago)`);
        }
      }
      if (staleCount > 0) {
        logger.info(`🧹 Cleaned ${staleCount} stale peer(s), ${peers.size} remaining`);
      }
    },

    getPeers() {
      return Array.from(peers.values());
    },

    getLocalNode() {
      return { name: nodeName, host: localHost, port };
    },
  };
}
