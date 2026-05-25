import * as os from "os";
import * as net from "net";
import { execFile } from "child_process";

export type PeerInfo = {
  name: string;
  host: string;
  port: number;
  lastSeen: number;
  source: "mdns" | "transport" | "subnet-scan" | "ping";
  lastTransportSeen?: number;
  lastMdnsSeen?: number;
  lastScanSeen?: number;
  lastPingSeen?: number;
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
  getLocalNode: () => { name: string; host: string; port: number; primaryAddress: string; addresses: string[] };
  notePeer: (peer: { name: string; host: string; port?: number; source?: "mdns" | "transport" | "subnet-scan" }) => void;
};

const MESH_SERVICE_TYPE = "oc-mesh";
const SCAN_PORT = 18790;
const SCAN_TIMEOUT_MS = 400;
const PING_TIMEOUT_MS = 2500;
const MAX_SCAN_CONCURRENCY = 24;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return false;
}

function isIgnoredInterface(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("docker") ||
    lower.startsWith("br-") ||
    lower.startsWith("veth") ||
    lower.startsWith("tailscale") ||
    lower.startsWith("utun") ||
    lower.startsWith("awdl") ||
    lower.startsWith("llw")
  );
}

function isPreferredLanInterface(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("en") || lower.startsWith("eth") || lower.startsWith("wlan") || lower.startsWith("wi-fi") || lower.startsWith("wifi");
}

function getLocalIPv4s(): Array<{ name: string; address: string }> {
  const interfaces = os.networkInterfaces();
  const nonInternal: Array<{ name: string; address: string }> = [];
  for (const name of Object.keys(interfaces)) {
    if (isIgnoredInterface(name)) continue;
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        nonInternal.push({ name, address: iface.address });
      }
    }
  }
  return nonInternal;
}

export function getLocalIPv4Addresses(): string[] {
  return getLocalIPv4s().map((iface) => iface.address);
}

export function normalizePeerHost(host: string): string {
  return host.startsWith("::ffff:") ? host.slice("::ffff:".length) : host;
}

export function isLocalIPv4Address(host: string): boolean {
  const normalized = normalizePeerHost(host);
  return normalized === "127.0.0.1" || getLocalIPv4Addresses().includes(normalized);
}

function getLocalIP(): string {
  const localIPv4s = getLocalIPv4s();
  const preferred = localIPv4s.find(({ name, address }) => isPreferredLanInterface(name) && isPrivateIPv4(address));
  if (preferred) return preferred.address;
  const privateFallback = localIPv4s.find(({ address }) => isPrivateIPv4(address));
  if (privateFallback) return privateFallback.address;
  const fallback = localIPv4s[0];
  return fallback ? fallback.address : "127.0.0.1";
}

function getSubnet(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return parts.slice(0, 3).join(".");
}

function getScanTargets(): Array<{ ip: string; subnet: string }> {
  const targets = new Map<string, string>();
  for (const iface of getLocalIPv4s()) {
    if (!isPrivateIPv4(iface.address)) continue;
    const subnet = getSubnet(iface.address);
    if (!subnet) continue;
    targets.set(subnet, iface.address);
  }
  return Array.from(targets.entries()).map(([subnet, ip]) => ({ subnet, ip }));
}

function probePort(ip: string, port: number): Promise<boolean> {
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

function probePing(ip: string): Promise<boolean> {
  const args = process.platform === "darwin" ? ["-c", "1", "-t", "1", ip] : ["-c", "1", "-W", "1", ip];
  return new Promise((resolve) => {
    execFile("ping", args, { timeout: PING_TIMEOUT_MS }, (err) => resolve(!err));
  });
}

async function scanSubnet(subnet: string, port: number, localIPs: Set<string>): Promise<Array<{ ip: string; portOpen: boolean; pingOk: boolean }>> {
  const results: Array<{ ip: string; portOpen: boolean; pingOk: boolean }> = [];
  const queue: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (!localIPs.has(ip)) queue.push(ip);
  }

  const workers = Array.from({ length: MAX_SCAN_CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const ip = queue.shift();
      if (!ip) continue;
      const [portOpen, pingOk] = await Promise.all([probePort(ip, port), probePing(ip)]);
      if (portOpen) results.push({ ip, portOpen, pingOk });
    }
  });

  await Promise.all(workers);
  return results;
}

export function createDiscovery(config: DiscoveryConfig): DiscoveryService {
  const { nodeName, port, logger } = config;
  const peers = new Map<string, PeerInfo>();
  let ciaoService: any = null;
  let bonjour: any = null;
  let browser: any = null;

  return {
    async start() {
      try {
        const { getResponder } = await import("@homebridge/ciao");
        const responder = getResponder();
        ciaoService = responder.createService({ name: nodeName, type: MESH_SERVICE_TYPE, port, txt: { node: nodeName, version: "1.0.0" } });
        await ciaoService.advertise();
        logger.info(`mDNS publisher started: ${nodeName} (${MESH_SERVICE_TYPE})`);
      } catch (err) {
        logger.error(`mDNS publish failed: ${err}`);
      }

      try {
        const { Bonjour } = await import("bonjour-service");
        bonjour = new Bonjour();
        browser = bonjour.find({ type: MESH_SERVICE_TYPE, protocol: "tcp" });
        browser.on("up", (svc: any) => {
          if (svc.name === nodeName) return;
          const addresses = svc.addresses || [];
          const ipv4 = addresses.find((a: string) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && a !== "127.0.0.1");
          const host = ipv4 || svc.referer?.address || svc.host || "unknown";
          const peerPort = svc.port || port;
          const existing = peers.get(svc.name);
          if (existing && existing.host === host && existing.port === peerPort) {
            existing.lastSeen = Date.now();
            existing.source = "mdns";
            existing.lastMdnsSeen = Date.now();
            return;
          }
          peers.set(svc.name, { name: svc.name, host, port: peerPort, lastSeen: Date.now(), source: "mdns", lastMdnsSeen: Date.now() });
          logger.info(`Peer discovered (mDNS): ${svc.name} at ${host}:${peerPort}`);
        });
        browser.on("down", (svc: any) => {
          if (peers.has(svc.name)) {
            peers.delete(svc.name);
            logger.info(`Peer disappeared (mDNS): ${svc.name}`);
          }
        });
        browser.start();
        logger.info("mDNS browser started");
      } catch (err) {
        logger.error(`mDNS browse failed: ${err}`);
      }

      logger.info(`Mesh discovery started: ${nodeName} at ${getLocalIP()}:${port}`);
    },

    async stop() {
      if (browser) { try { browser.stop(); } catch {} }
      if (bonjour) { try { bonjour.destroy(); } catch {} }
      if (ciaoService) { try { await ciaoService.end(); } catch {} }
      logger.info("Mesh discovery stopped");
    },

    async scan() {
      if (browser) {
        try { browser.update(); } catch {}
      }
      const scanTargets = getScanTargets();
      const localIPs = new Set(getLocalIPv4Addresses());
      if (scanTargets.length > 0) {
        const localSummary = scanTargets.map(({ subnet, ip }) => `${ip} -> ${subnet}.0/24`).join(", ");
        logger.info(`Scanning local subnets for mesh nodes on port ${SCAN_PORT}: ${localSummary}`);
        try {
          let totalFound = 0;
          for (const target of scanTargets) {
            const found = await scanSubnet(target.subnet, SCAN_PORT, localIPs);
            totalFound += found.length;
            for (const entry of found) {
              const { ip, portOpen, pingOk } = entry;
              const existingPeer = Array.from(peers.values()).find((p) => p.host === ip);
              if (existingPeer) {
                existingPeer.lastSeen = Date.now();
                existingPeer.source = portOpen ? "subnet-scan" : "ping";
                existingPeer.lastScanSeen = Date.now();
                if (pingOk) existingPeer.lastPingSeen = Date.now();
              } else {
                const peerName = `node-${ip.split(".")[3]}`;
                peers.set(peerName, {
                  name: peerName,
                  host: ip,
                  port: portOpen ? SCAN_PORT : port,
                  lastSeen: Date.now(),
                  source: portOpen ? "subnet-scan" : "ping",
                  lastScanSeen: Date.now(),
                  lastPingSeen: pingOk ? Date.now() : undefined,
                });
                logger.info(`Peer discovered (subnet scan): ${peerName} at ${ip}:${portOpen ? SCAN_PORT : port} (${pingOk ? "ping" : "tcp"})`);
              }
            }
          }
          logger.info(`Subnet scan complete: ${totalFound} mesh node(s) found`);
        } catch (err) {
          logger.error(`Subnet scan failed: ${err}`);
        }
      }

      const now = Date.now();
      let staleCount = 0;
      for (const [name, peer] of peers) {
        if (now - peer.lastSeen > 300000) {
          peers.delete(name);
          staleCount++;
          logger.warn(`Stale peer removed: ${name}`);
        }
      }
      if (staleCount > 0) logger.info(`Cleaned ${staleCount} stale peer(s), ${peers.size} remaining`);
    },

    getPeers() {
      return Array.from(peers.values());
    },

    getLocalNode() {
      const primaryAddress = getLocalIP();
      const addresses = getLocalIPv4Addresses();
      return { name: nodeName, host: primaryAddress, port, primaryAddress, addresses };
    },

    notePeer(peer) {
      const normalizedHost = normalizePeerHost(peer.host || "");
      if (!peer.name || peer.name === nodeName || !normalizedHost || isLocalIPv4Address(normalizedHost)) return;
      const existing = peers.get(peer.name);
      const peerPort = peer.port || port;
      const now = Date.now();
      const source = peer.source || "transport";
      if (existing) {
        existing.host = normalizedHost;
        existing.port = peerPort;
        existing.lastSeen = now;
        existing.source = source;
        if (source === "transport") existing.lastTransportSeen = now;
        if (source === "mdns") existing.lastMdnsSeen = now;
        if (source === "subnet-scan") existing.lastScanSeen = now;
        return;
      }
      peers.set(peer.name, {
        name: peer.name,
        host: normalizedHost,
        port: peerPort,
        lastSeen: now,
        source,
        lastTransportSeen: source === "transport" ? now : undefined,
        lastMdnsSeen: source === "mdns" ? now : undefined,
        lastScanSeen: source === "subnet-scan" ? now : undefined,
      });
      logger.info(`Peer noted from transport activity: ${peer.name} at ${peer.host}:${peerPort}`);
    },
  };
}
