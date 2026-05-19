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
export type TrustCheck = {
    trusted: true;
    mismatch: false;
    peer?: TrustedPeer;
} | {
    trusted: false;
    mismatch: boolean;
    peer?: TrustedPeer;
};
export declare function formatFingerprint(publicKey: string): string;
export declare function encodePublicKeyForWire(publicKey: string): string;
export declare function decodePublicKeyFromWire(value: unknown): string | null;
export declare function loadOrCreateIdentity(baseDir?: string): MeshIdentity;
export declare function signIdentityChallenge(identity: MeshIdentity, nonce: string, peerName: string, fingerprint?: string): string;
export declare function verifyIdentityProof(publicKey: string, nonce: string, peerName: string, fingerprint: string, signature: string): boolean;
export declare function createNonce(): string;
export declare function loadTrustedPeers(baseDir?: string): TrustedPeer[];
export declare function saveTrustedPeers(peers: TrustedPeer[], baseDir?: string): void;
export declare function trustPeer(peerName: string, fingerprint: string, publicKey: string, baseDir?: string): TrustedPeer;
export declare function checkTrustedPeer(peerName: string, fingerprint: string, baseDir?: string): TrustCheck;
export declare function touchTrustedPeer(peerName: string, baseDir?: string): void;
