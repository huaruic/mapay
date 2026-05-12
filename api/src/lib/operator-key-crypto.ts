// AES-256-GCM envelope for per-agent operator burner keys.
//
// Design (per spec §10.5):
//   - KEK = `OPERATOR_MASTER_KEY` env var, base64-decoded to 32 bytes.
//     This is the long-lived "master key" — held in the API process env;
//     never serialised to disk by us. In production this gets sourced from
//     KMS / Hashicorp Vault; the wire format below stays unchanged.
//   - DEK = derived per-record via HKDF(SHA-256, salt=IV, ikm=KEK, info="agentpay/operator-key/v1")
//     so each wrap uses an independent 256-bit key even though the master
//     never changes. Compromising one ciphertext doesn't expose any other.
//   - Wrap: AES-256-GCM with a fresh 12-byte IV; auth tag 16 bytes. The
//     `keyVersion` field is metadata that travels alongside the ciphertext —
//     bump it when rotating the master key so we can decrypt old records.
//
// Wire format (stored as a single BYTEA in `operator_keys.encrypted_privkey`):
//   IV (12 bytes) || authTag (16 bytes) || ciphertext (var)
// `kdf_params` JSONB documents `{ version, algo }` for forensics.

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const CURRENT_KEY_VERSION = 1;
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const HKDF_INFO = Buffer.from("agentpay/operator-key/v1");

export interface WrappedKey {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/**
 * Load the master KEK from env. Returns a 32-byte Buffer or throws if the var
 * is missing / malformed. Not cached so test code can rotate the env between
 * cases via `process.env.OPERATOR_MASTER_KEY = ...`.
 */
function loadMasterKey(): Buffer {
  const raw = process.env.OPERATOR_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "OPERATOR_MASTER_KEY env var not set — required for operator key encryption",
    );
  }
  // base64-decoded must be exactly 32 bytes.
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("OPERATOR_MASTER_KEY is not valid base64");
  }
  if (key.length !== 32) {
    throw new Error(
      `OPERATOR_MASTER_KEY must decode to 32 bytes (got ${key.length})`,
    );
  }
  return key;
}

/**
 * Derive a per-record DEK from the master key using HKDF-SHA256, salting with
 * the IV. Same IV → same DEK → safe to recompute on unwrap.
 */
function deriveDek(kek: Buffer, iv: Buffer): Buffer {
  // hkdfSync returns ArrayBuffer in Node — convert via Buffer.from.
  const out = hkdfSync("sha256", kek, iv, HKDF_INFO, 32);
  return Buffer.from(out);
}

/**
 * Encrypt a plaintext key (e.g. raw secp256k1 private key bytes).
 * Throws if `OPERATOR_MASTER_KEY` is missing/malformed.
 */
export function wrapKey(plaintext: Buffer): WrappedKey {
  if (!Buffer.isBuffer(plaintext) || plaintext.length === 0) {
    throw new Error("wrapKey: plaintext must be a non-empty Buffer");
  }
  const kek = loadMasterKey();
  const iv = randomBytes(IV_LEN);
  const dek = deriveDek(kek, iv);
  const cipher = createCipheriv(ALGO, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag, keyVersion: CURRENT_KEY_VERSION };
}

/**
 * Decrypt a wrapped key. Throws if:
 *   - keyVersion is unknown
 *   - authTag doesn't verify (tamper or wrong master key)
 *   - master key is missing / wrong size
 */
export function unwrapKey(wrapped: WrappedKey): Buffer {
  if (wrapped.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(
      `unwrapKey: unknown key version ${wrapped.keyVersion} (expected ${CURRENT_KEY_VERSION})`,
    );
  }
  if (wrapped.iv.length !== IV_LEN) {
    throw new Error(`unwrapKey: iv must be ${IV_LEN} bytes`);
  }
  if (wrapped.authTag.length !== AUTH_TAG_LEN) {
    throw new Error(`unwrapKey: authTag must be ${AUTH_TAG_LEN} bytes`);
  }
  const kek = loadMasterKey();
  const dek = deriveDek(kek, wrapped.iv);
  const decipher = createDecipheriv(ALGO, dek, wrapped.iv);
  decipher.setAuthTag(wrapped.authTag);
  // .final() throws if the auth tag doesn't verify.
  return Buffer.concat([decipher.update(wrapped.ciphertext), decipher.final()]);
}

/**
 * Pack a WrappedKey into the on-disk BYTEA layout: IV || authTag || ciphertext.
 */
export function packWrapped(wrapped: WrappedKey): Buffer {
  return Buffer.concat([wrapped.iv, wrapped.authTag, wrapped.ciphertext]);
}

/**
 * Inverse of packWrapped. Caller passes the keyVersion from the row metadata
 * (column `key_version`).
 */
export function unpackWrapped(blob: Buffer, keyVersion: number): WrappedKey {
  if (blob.length < IV_LEN + AUTH_TAG_LEN) {
    throw new Error("unpackWrapped: blob too short");
  }
  return {
    iv: blob.subarray(0, IV_LEN),
    authTag: blob.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN),
    ciphertext: blob.subarray(IV_LEN + AUTH_TAG_LEN),
    keyVersion,
  };
}

/**
 * KDF params written to `operator_keys.kdf_params` JSONB column — captures the
 * scheme used so future migrations / rotations can read old records.
 */
export function currentKdfParams(): {
  version: number;
  algo: string;
  kdf: string;
  info: string;
} {
  return {
    version: CURRENT_KEY_VERSION,
    algo: "AES-256-GCM",
    kdf: "HKDF-SHA256",
    info: HKDF_INFO.toString("utf8"),
  };
}

export const __testing = {
  CURRENT_KEY_VERSION,
  IV_LEN,
  AUTH_TAG_LEN,
};
