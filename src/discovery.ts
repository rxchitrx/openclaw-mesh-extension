export type PeerInfo = {
  name: string;
  host: string;
  port: number;
  lastSeen: number;
};

export type DiscoveryConfig = {
  nodeName: string;
  port: number;
  logger: any;
};

export type DiscoveryService = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  scan: () => Promise<void>;
  getPeers: () => PeerInfo[];
  getLocalNode: () => { name: string; host: string; port: number };
};

const MESH_SERVICE_TYPE = "_oc-mesh._tcp";

export function createDiscovery(config: DiscoveryConfig): DiscoveryService {
  const { nodeName, port, logger } = config;
  const peers = new Map<string, PeerInfo>();

  let service: any = null;
  let localHost = "0.0.0.0";

  const getLocalIP = async (): Promise<string> => {
    const os = await import("os");
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
    return "127.0.0.1";
  };

  return {
    async start() {
      localHost = await getLocalIP();

      try {
        const { getResponder } = await import("@homebridge/ciao");

        const responder = getResponder();
        service = responder.createService({
          name: nodeName,
          type: MESH_SERVICE_TYPE,
          port: port,
          txt: {
            node: nodeName,
            version: "1.0.0",
          },
        });

        await service.advertise();
        logger.info(`Mesh discovery started: ${nodeName} at ${localHost}:${port} (${MESH_SERVICE_TYPE})`);
        logger.info(`Note: Peer browsing via mDNS is not supported by @homebridge/ciao (advertiser-only). Manual peer config or P2P scanning needed.`);
      } catch (err) {
        logger.error(`Failed to start mDNS discovery: ${err}`);
        logger.warn("Mesh will run in standalone mode (no peer discovery)");
      }
    },

    async stop() {
      if (service) {
        try {
          await service.end();
          logger.info("Mesh discovery stopped");
        } catch (err) {
          logger.error(`Error stopping discovery: ${err}`);
        }
      }
    },

    async scan() {
      const now = Date.now();
      let staleCount = 0;
      for (const [name, peer] of peers) {
        if (now - peer.lastSeen > 60000) {
          peers.delete(name);
          staleCount++;
          logger.warn(`Stale peer removed: ${name} (last seen ${Math.floor((now - peer.lastSeen) / 1000)}s ago)`);
        }
      }
      if (staleCount > 0) {
        logger.info(`Cleaned ${staleCount} stale peer(s), ${peers.size} remaining`);
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
