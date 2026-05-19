import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type MeshIdentity = {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
};

export type TrustedPeer = {
  peerName: string;
  fingerprint: string;
  publicKey: string;
  approvedAt: number;
  lastSeenAt: number;
};

export type TrustCheck =
  | { trusted: true; mismatch: false; peer?: TrustedPeer }
  | { trusted: false; mismatch: boolean; peer?: TrustedPeer };

const DEFAULT_DIR = path.join(os.homedir(), ".openclaw", "mesh");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function identityPath(baseDir = DEFAULT_DIR) {
  return path.join(baseDir, "identity.json");
}

function trustedPeersPath(baseDir = DEFAULT_DIR) {
  return path.join(baseDir, "trusted-peers.json");
}

export function formatFingerprint(publicKey: string): string {
  const hex = crypto.createHash("sha256").update(publicKey).digest("hex").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function encodePublicKeyForWire(publicKey: string): string {
  return Buffer.from(publicKey, "utf-8").toString("base64url");
}

export function decodePublicKeyFromWire(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf-8");
    if (!decoded.includes("BEGIN PUBLIC KEY")) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function loadOrCreateIdentity(baseDir = DEFAULT_DIR): MeshIdentity {
  ensureDir(baseDir);
  const filePath = identityPath(baseDir);
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof existing.privateKey === "string" && typeof existing.publicKey === "string") {
      return {
        privateKey: existing.privateKey,
        publicKey: existing.publicKey,
        fingerprint: formatFingerprint(existing.publicKey),
      };
    }
  } catch {}

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const identity: MeshIdentity = {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    fingerprint: "",
  };
  identity.fingerprint = formatFingerprint(identity.publicKey);
  fs.writeFileSync(filePath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}

export function signIdentityChallenge(identity: MeshIdentity, nonce: string, peerName: string, fingerprint = identity.fingerprint): string {
  const payload = `${nonce}:${peerName}:${fingerprint}`;
  return crypto.sign(null, Buffer.from(payload), identity.privateKey).toString("base64");
}

export function verifyIdentityProof(publicKey: string, nonce: string, peerName: string, fingerprint: string, signature: string): boolean {
  try {
    const expectedFingerprint = formatFingerprint(publicKey);
    if (expectedFingerprint !== fingerprint) return false;
    const payload = `${nonce}:${peerName}:${fingerprint}`;
    return crypto.verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function createNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function loadTrustedPeers(baseDir = DEFAULT_DIR): TrustedPeer[] {
  ensureDir(baseDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(trustedPeersPath(baseDir), "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((peer) =>
      peer &&
      typeof peer.peerName === "string" &&
      typeof peer.fingerprint === "string" &&
      typeof peer.publicKey === "string"
    );
  } catch {
    return [];
  }
}

export function saveTrustedPeers(peers: TrustedPeer[], baseDir = DEFAULT_DIR) {
  ensureDir(baseDir);
  fs.writeFileSync(trustedPeersPath(baseDir), JSON.stringify(peers, null, 2), { mode: 0o600 });
}

export function trustPeer(peerName: string, fingerprint: string, publicKey: string, baseDir = DEFAULT_DIR): TrustedPeer {
  const peers = loadTrustedPeers(baseDir).filter((peer) => peer.peerName !== peerName);
  const now = Date.now();
  const peer: TrustedPeer = { peerName, fingerprint, publicKey, approvedAt: now, lastSeenAt: now };
  peers.push(peer);
  saveTrustedPeers(peers, baseDir);
  return peer;
}

export function checkTrustedPeer(peerName: string, fingerprint: string, baseDir = DEFAULT_DIR): TrustCheck {
  const peer = loadTrustedPeers(baseDir).find((item) => item.peerName === peerName);
  if (!peer) return { trusted: false, mismatch: false };
  if (peer.fingerprint !== fingerprint) return { trusted: false, mismatch: true, peer };
  return { trusted: true, mismatch: false, peer };
}

export function touchTrustedPeer(peerName: string, baseDir = DEFAULT_DIR) {
  const peers = loadTrustedPeers(baseDir);
  const peer = peers.find((item) => item.peerName === peerName);
  if (!peer) return;
  peer.lastSeenAt = Date.now();
  saveTrustedPeers(peers, baseDir);
}
