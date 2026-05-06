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

const MESH_SERVICE_TYPE = "oc-mesh";

export function createDiscovery(config: DiscoveryConfig): DiscoveryService {
  const { nodeName, port, logger } = config;
  const peers = new Map<string, PeerInfo>();

  let bonjour: any = null;
  let service: any = null;
  let browser: any = null;
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
        const { Bonjour } = await import("bonjour-service");
        bonjour = new Bonjour();

        service = bonjour.publish({
          name: nodeName,
          type: MESH_SERVICE_TYPE,
          protocol: "tcp",
          port: port,
          txt: {
            node: nodeName,
            version: "1.0.0",
          },
        });

        service.start();

        browser = bonjour.find({ type: MESH_SERVICE_TYPE, protocol: "tcp" });

        browser.on("up", (svc: any) => {
          if (svc.name === nodeName) return;

          const host = svc.referer?.address || svc.host || "unknown";
          const peerPort = svc.port || port;

          const existing = peers.get(svc.name);
          if (existing && existing.host === host && existing.port === peerPort) {
            existing.lastSeen = Date.now();
            return;
          }

          const peer: PeerInfo = {
            name: svc.name,
            host,
            port: peerPort,
            lastSeen: Date.now(),
          };

          peers.set(svc.name, peer);
          logger.info(`Peer discovered: ${svc.name} at ${host}:${peerPort}`);
        });

        browser.on("down", (svc: any) => {
          if (peers.has(svc.name)) {
            peers.delete(svc.name);
            logger.info(`Peer disappeared: ${svc.name}`);
          }
        });

        browser.start();

        logger.info(`Mesh discovery started: ${nodeName} at ${localHost}:${port} (${MESH_SERVICE_TYPE})`);
      } catch (err) {
        logger.error(`Failed to start mDNS discovery: ${err}`);
        logger.warn("Mesh will run in standalone mode (no peer discovery)");
      }
    },

    async stop() {
      if (browser) {
        try {
          browser.stop();
        } catch {}
      }
      if (service) {
        try {
          service.stop();
        } catch {}
      }
      if (bonjour) {
        try {
          bonjour.destroy();
        } catch {}
      }
      logger.info("Mesh discovery stopped");
    },

    async scan() {
      if (browser) {
        try {
          browser.update();
        } catch {}
      }

      const now = Date.now();
      let staleCount = 0;
      for (const [name, peer] of peers) {
        if (now - peer.lastSeen > 120000) {
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
