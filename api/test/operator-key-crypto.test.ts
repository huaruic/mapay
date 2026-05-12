// Tests for the AES-256-GCM envelope used to encrypt operator burner keys at
// rest (see `src/lib/operator-key-crypto.ts`).

import "./helpers/setup-env.js";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  __testing,
  currentKdfParams,
  packWrapped,
  unpackWrapped,
  unwrapKey,
  wrapKey,
  type WrappedKey,
} from "../src/lib/operator-key-crypto.js";

// A deterministic 32-byte test master key — base64 of 32 zero bytes works, but
// we randomise so a real value-pinning regression would surface here too.
const TEST_MASTER_KEY_B64 = randomBytes(32).toString("base64");

let savedMasterKey: string | undefined;
beforeAll(() => {
  savedMasterKey = process.env.OPERATOR_MASTER_KEY;
  process.env.OPERATOR_MASTER_KEY = TEST_MASTER_KEY_B64;
});
afterAll(() => {
  if (savedMasterKey === undefined) {
    delete process.env.OPERATOR_MASTER_KEY;
  } else {
    process.env.OPERATOR_MASTER_KEY = savedMasterKey;
  }
});

const samplePlaintext = (): Buffer =>
  Buffer.from(
    "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "hex",
  );

describe("operator-key-crypto — round-trip", () => {
  test("wrap then unwrap returns the original plaintext", () => {
    const plain = samplePlaintext();
    const wrapped = wrapKey(plain);
    expect(wrapped.iv).toHaveLength(__testing.IV_LEN);
    expect(wrapped.authTag).toHaveLength(__testing.AUTH_TAG_LEN);
    expect(wrapped.keyVersion).toBe(__testing.CURRENT_KEY_VERSION);
    expect(wrapped.ciphertext).toHaveLength(plain.length);

    const out = unwrapKey(wrapped);
    expect(out.equals(plain)).toBe(true);
  });

  test("pack / unpack preserves wire format", () => {
    const wrapped = wrapKey(samplePlaintext());
    const blob = packWrapped(wrapped);
    expect(blob.length).toBe(
      __testing.IV_LEN + __testing.AUTH_TAG_LEN + wrapped.ciphertext.length,
    );
    const reparsed = unpackWrapped(blob, wrapped.keyVersion);
    expect(reparsed.iv.equals(wrapped.iv)).toBe(true);
    expect(reparsed.authTag.equals(wrapped.authTag)).toBe(true);
    expect(reparsed.ciphertext.equals(wrapped.ciphertext)).toBe(true);
    expect(unwrapKey(reparsed).equals(samplePlaintext())).toBe(true);
  });

  test("each wrap produces a fresh IV (no nonce reuse)", () => {
    const w1 = wrapKey(samplePlaintext());
    const w2 = wrapKey(samplePlaintext());
    expect(w1.iv.equals(w2.iv)).toBe(false);
    // Same plaintext + different IV ⇒ different ciphertext (and tag).
    expect(w1.ciphertext.equals(w2.ciphertext)).toBe(false);
  });

  test("currentKdfParams documents the algorithm", () => {
    const p = currentKdfParams();
    expect(p.algo).toBe("AES-256-GCM");
    expect(p.version).toBe(__testing.CURRENT_KEY_VERSION);
    expect(p.kdf).toBe("HKDF-SHA256");
  });
});

describe("operator-key-crypto — tamper resistance", () => {
  test("flipped authTag → unwrap throws", () => {
    const wrapped = wrapKey(samplePlaintext());
    const bad: WrappedKey = {
      ...wrapped,
      authTag: Buffer.from(wrapped.authTag),
    };
    bad.authTag[0] ^= 0xff;
    expect(() => unwrapKey(bad)).toThrow();
  });

  test("flipped ciphertext → unwrap throws", () => {
    const wrapped = wrapKey(samplePlaintext());
    const bad: WrappedKey = {
      ...wrapped,
      ciphertext: Buffer.from(wrapped.ciphertext),
    };
    bad.ciphertext[0] ^= 0xff;
    expect(() => unwrapKey(bad)).toThrow();
  });

  test("wrong master key → unwrap throws", () => {
    const wrapped = wrapKey(samplePlaintext());
    const previous = process.env.OPERATOR_MASTER_KEY;
    process.env.OPERATOR_MASTER_KEY = randomBytes(32).toString("base64");
    try {
      expect(() => unwrapKey(wrapped)).toThrow();
    } finally {
      process.env.OPERATOR_MASTER_KEY = previous;
    }
  });

  test("unknown keyVersion → unwrap throws with explicit message", () => {
    const wrapped = wrapKey(samplePlaintext());
    expect(() =>
      unwrapKey({ ...wrapped, keyVersion: 2 }),
    ).toThrow(/unknown key version 2/);
  });
});

describe("operator-key-crypto — input validation", () => {
  test("empty plaintext rejected", () => {
    expect(() => wrapKey(Buffer.alloc(0))).toThrow();
  });

  test("missing master key throws", () => {
    const previous = process.env.OPERATOR_MASTER_KEY;
    delete process.env.OPERATOR_MASTER_KEY;
    try {
      expect(() => wrapKey(samplePlaintext())).toThrow(/not set/);
    } finally {
      process.env.OPERATOR_MASTER_KEY = previous;
    }
  });

  test("malformed master key (wrong length) throws", () => {
    const previous = process.env.OPERATOR_MASTER_KEY;
    process.env.OPERATOR_MASTER_KEY = Buffer.alloc(16).toString("base64");
    try {
      expect(() => wrapKey(samplePlaintext())).toThrow(/32 bytes/);
    } finally {
      process.env.OPERATOR_MASTER_KEY = previous;
    }
  });

  test("unpackWrapped rejects short blobs", () => {
    expect(() => unpackWrapped(Buffer.alloc(10), 1)).toThrow();
  });
});
