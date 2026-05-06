import * as os from "os";
import * as net from "net";
const MESH_SERVICE_TYPE = "oc-mesh";
const SCAN_PORT = 18790;
const SCAN_TIMEOUT_MS = 400;
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
function getSubnet(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4)
        return null;
    return parts.slice(0, 3).join(".");
}
function probePort(ip, port) {
    return new Promise((resolve) => {
        const sock = new net.Socket();
        sock.setTimeout(SCAN_TIMEOUT_MS);
        sock.on("connect", () => {
            sock.destroy();
            resolve(true);
        });
        sock.on("error", () => {
            sock.destroy();
            resolve(false);
        });
        sock.on("timeout", () => {
            sock.destroy();
            resolve(false);
        });
        sock.connect(port, ip);
    });
}
async function scanSubnet(subnet, port, localIP) {
    const promises = [];
    for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        if (ip === localIP)
            continue;
        promises.push(probePort(ip, port).then((open) => (open ? ip : "")));
    }
    const results = await Promise.all(promises);
    return results.filter(Boolean);
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
                    txt: { node: nodeName, version: "1.0.0" },
                });
                await ciaoService.advertise();
                logger.info(`mDNS publisher started: ${nodeName} (${MESH_SERVICE_TYPE})`);
            }
            catch (err) {
                logger.error(`mDNS publish failed: ${err}`);
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
                    peers.set(svc.name, { name: svc.name, host, port: peerPort, lastSeen: Date.now() });
                    logger.info(`Peer discovered (mDNS): ${svc.name} at ${host}:${peerPort}`);
                });
                browser.on("down", (svc) => {
                    if (peers.has(svc.name)) {
                        peers.delete(svc.name);
                        logger.info(`Peer disappeared (mDNS): ${svc.name}`);
                    }
                });
                browser.start();
                logger.info(`mDNS browser started`);
            }
            catch (err) {
                logger.error(`mDNS browse failed: ${err}`);
            }
            const localIP = getLocalIP();
            logger.info(`Mesh discovery started: ${nodeName} at ${localIP}:${port}`);
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
            const localIP = getLocalIP();
            const subnet = getSubnet(localIP);
            if (subnet) {
                logger.info(`Scanning subnet ${subnet}.0/24 for mesh nodes on port ${SCAN_PORT}...`);
                try {
                    const found = await scanSubnet(subnet, SCAN_PORT, localIP);
                    for (const ip of found) {
                        const existingPeer = Array.from(peers.values()).find((p) => p.host === ip);
                        if (existingPeer) {
                            existingPeer.lastSeen = Date.now();
                        }
                        else {
                            const peerName = `node-${ip.split(".")[3]}`;
                            peers.set(peerName, { name: peerName, host: ip, port: SCAN_PORT, lastSeen: Date.now() });
                            logger.info(`Peer discovered (subnet scan): ${peerName} at ${ip}:${SCAN_PORT}`);
                        }
                    }
                    logger.info(`Subnet scan complete: ${found.length} mesh node(s) found`);
                }
                catch (err) {
                    logger.error(`Subnet scan failed: ${err}`);
                }
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
