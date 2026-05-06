const MESH_SERVICE_TYPE = "oc-mesh";
import * as os from "os";
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const nonInternal = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === "IPv4" && !iface.internal) {
                nonInternal.push({ name, address: iface.address });
            }
        }
    }
    if (nonInternal.length === 0)
        return "127.0.0.1";
    return nonInternal[nonInternal.length - 1].address;
}
export function createDiscovery(config) {
    const { nodeName, port, logger } = config;
    const peers = new Map();
    let ciaoService = null;
    let bonjour = null;
    let browser = null;
    return {
        async start() {
            try {
                const { getResponder } = await import("@homebridge/ciao");
                const responder = getResponder();
                ciaoService = responder.createService({
                    name: nodeName,
                    type: MESH_SERVICE_TYPE,
                    port: port,
                    txt: {
                        node: nodeName,
                        version: "1.0.0",
                    },
                });
                await ciaoService.advertise();
                logger.info(`mDNS publisher started: ${nodeName} (${MESH_SERVICE_TYPE}) via ciao`);
            }
            catch (err) {
                logger.error(`Failed to start mDNS publisher: ${err}`);
            }
            try {
                const { Bonjour } = await import("bonjour-service");
                bonjour = new Bonjour();
                browser = bonjour.find({ type: MESH_SERVICE_TYPE, protocol: "tcp" });
                browser.on("up", (svc) => {
                    if (svc.name === nodeName)
                        return;
                    const addresses = svc.addresses || [];
                    const ipv4 = addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && a !== "127.0.0.1");
                    const host = ipv4 || svc.referer?.address || svc.host || "unknown";
                    const peerPort = svc.port || port;
                    const existing = peers.get(svc.name);
                    if (existing && existing.host === host && existing.port === peerPort) {
                        existing.lastSeen = Date.now();
                        return;
                    }
                    const peer = {
                        name: svc.name,
                        host,
                        port: peerPort,
                        lastSeen: Date.now(),
                    };
                    peers.set(svc.name, peer);
                    logger.info(`Peer discovered: ${svc.name} at ${host}:${peerPort}`);
                });
                browser.on("down", (svc) => {
                    if (peers.has(svc.name)) {
                        peers.delete(svc.name);
                        logger.info(`Peer disappeared: ${svc.name}`);
                    }
                });
                browser.start();
                logger.info(`mDNS browser started for ${MESH_SERVICE_TYPE}`);
            }
            catch (err) {
                logger.error(`Failed to start mDNS browser: ${err}`);
                logger.warn("Peer browsing unavailable");
            }
            logger.info(`Mesh discovery started: ${nodeName} at ${getLocalIP()}:${port} (${MESH_SERVICE_TYPE})`);
        },
        async stop() {
            if (browser) {
                try {
                    browser.stop();
                }
                catch { }
            }
            if (bonjour) {
                try {
                    bonjour.destroy();
                }
                catch { }
            }
            if (ciaoService) {
                try {
                    await ciaoService.end();
                }
                catch { }
            }
            logger.info("Mesh discovery stopped");
        },
        async scan() {
            if (browser) {
                try {
                    browser.update();
                }
                catch { }
            }
            const now = Date.now();
            let staleCount = 0;
            for (const [name, peer] of peers) {
                if (now - peer.lastSeen > 120000) {
                    peers.delete(name);
                    staleCount++;
                    logger.warn(`Stale peer removed: ${name}`);
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
            return { name: nodeName, host: getLocalIP(), port };
        },
    };
}
