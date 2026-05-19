import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  checkTrustedPeer,
  createNonce,
  decodePublicKeyFromWire,
  encodePublicKeyForWire,
  loadOrCreateIdentity,
  signIdentityChallenge,
  trustPeer,
  verifyIdentityProof,
} from "../dist/src/peer-identity.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-identity-"));

try {
  const identity = loadOrCreateIdentity(tempDir);
  assert.match(identity.fingerprint, /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  assert.match(identity.privateKey, /PRIVATE KEY/);
  assert.match(identity.publicKey, /PUBLIC KEY/);
  const encodedPublicKey = encodePublicKeyForWire(identity.publicKey);
  assert.equal(encodedPublicKey.includes("\n"), false);
  assert.equal(decodePublicKeyFromWire(encodedPublicKey), identity.publicKey);
  assert.equal(decodePublicKeyFromWire("not-a-key"), null);

  const reloaded = loadOrCreateIdentity(tempDir);
  assert.equal(reloaded.fingerprint, identity.fingerprint);
  assert.equal(reloaded.publicKey, identity.publicKey);

  const peerName = "laptop-b";
  const nonce = createNonce();
  const signature = signIdentityChallenge(identity, nonce, peerName);
  assert.equal(verifyIdentityProof(identity.publicKey, nonce, peerName, identity.fingerprint, signature), true);
  assert.equal(verifyIdentityProof(identity.publicKey, `${nonce}-tampered`, peerName, identity.fingerprint, signature), false);
  assert.equal(verifyIdentityProof(identity.publicKey, nonce, "impostor", identity.fingerprint, signature), false);

  const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-identity-other-"));
  try {
    const other = loadOrCreateIdentity(otherDir);
    assert.equal(verifyIdentityProof(other.publicKey, nonce, peerName, identity.fingerprint, signature), false);
  } finally {
    await fs.rm(otherDir, { recursive: true, force: true });
  }

  trustPeer(peerName, identity.fingerprint, identity.publicKey, tempDir);
  assert.equal(checkTrustedPeer(peerName, identity.fingerprint, tempDir).trusted, true);
  const mismatch = checkTrustedPeer(peerName, "AAAA-BBBB-CCCC", tempDir);
  assert.equal(mismatch.trusted, false);
  assert.equal(mismatch.mismatch, true);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("peer-identity tests passed");
