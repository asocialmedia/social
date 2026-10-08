import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";

import type { MessageIdentityPayload } from "./client";
import {
  deriveMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateIdentityKeyPair,
  hashAccountSecret,
  publicKeyJwkToBase64,
  setMessageKeyStore,
  setNativeMasterKeyDeriver,
} from "./crypto";
import { bytesToBase64 } from "./crypto-primitives";
import { bootstrapMessageIdentity } from "./identity-bootstrap";

let privateKeys = new Map<string, JsonWebKey>();
let secrets = new Map<string, string>();

beforeEach(() => {
  privateKeys = new Map();
  secrets = new Map();
  setMessageKeyStore({
    clear: (userId) => {
      privateKeys.delete(userId);
      return Promise.resolve();
    },
    getPrivateKey: (userId) => Promise.resolve(privateKeys.get(userId) ?? null),
    getStoredAccountSecret: (userId) =>
      Promise.resolve(secrets.get(userId) ?? null),
    setPrivateKey: (userId, key) => {
      privateKeys.set(userId, key);
      return Promise.resolve();
    },
  });
});
afterEach(() => setNativeMasterKeyDeriver(null));

async function backup(
  material: string,
  hash = material
): Promise<MessageIdentityPayload> {
  const pair = generateIdentityKeyPair();
  const salt = new Uint8Array(16).fill(7);
  const encrypted = await encryptWithMasterKey(
    await deriveMasterKey(material, salt, 1000),
    JSON.stringify(exportPrivateKeyJwk(pair.privateKey))
  );
  return {
    createdAt: "2026-10-09",
    encryptedPrivateKey: `${encrypted.iv}.${encrypted.ciphertext}`,
    kdfIterations: 1000,
    masterKeyHash: hash,
    publicKey: publicKeyJwkToBase64(exportPublicKeyJwk(pair.publicKey)),
    salt: bytesToBase64(salt),
    updatedAt: "2026-10-09",
  };
}

function api(identity: MessageIdentityPayload | null) {
  let gets = 0;
  let saves = 0;
  const baseFetch: typeof fetch = Object.assign(
    (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        saves += 1;
        return Promise.resolve(Response.json({ identity }));
      }
      gets += 1;
      return Promise.resolve(Response.json({ identity }));
    },
    { preconnect: fetch.preconnect }
  );
  return {
    counts: () => ({ gets, saves }),
    options: {
      apiBase: "https://test.invalid",
      baseFetch,
    } satisfies ApiCallOptions,
  };
}

describe("message identity lifecycle", () => {
  test("a fresh device recovers from the stored row alone and the next open skips the KDF", async () => {
    const identity = await backup("stored-row-hash");
    const transport = api(identity);
    const result = await bootstrapMessageIdentity("fresh", transport.options);
    expect(result.status).toBe("ready");
    expect(privateKeys.has("fresh")).toBe(true);
    setNativeMasterKeyDeriver(() => {
      throw new Error("a cached identity must not derive again");
    });
    const resolved1 = await bootstrapMessageIdentity(
      "fresh",
      transport.options
    );
    expect(resolved1.status).toBe("ready");
  });

  test("abandoned verifier rows still unlock with the device secret", async () => {
    const secret = "old-device-only-secret";
    secrets.set("legacy", secret);
    const identity = await backup(secret, await hashAccountSecret(secret));
    const resolved2 = await bootstrapMessageIdentity(
      "legacy",
      api(identity).options
    );
    expect(resolved2.status).toBe("ready");
  });

  test("an unreadable row stays locked and does not overwrite any identity", async () => {
    const identity = await backup("lost-secret", "unusable-hash");
    const transport = api(identity);
    const resolved3 = await bootstrapMessageIdentity(
      "locked",
      transport.options
    );
    expect(resolved3.status).toBe("locked");
    expect(transport.counts().saves).toBe(0);
    expect(privateKeys.has("locked")).toBe(false);
  });

  test("rapid remounts share one fresh-device provision", async () => {
    const transport = api(null);
    const first = bootstrapMessageIdentity("new", transport.options);
    const second = bootstrapMessageIdentity("new", transport.options);
    expect(second).toBe(first);
    const provisioned = await first;
    expect(provisioned.status).toBe("ready");
    expect(transport.counts()).toEqual({ gets: 1, saves: 1 });
  });

  test("a key cached before another-device reset recovers the current stored identity", async () => {
    privateKeys.set(
      "reset",
      exportPrivateKeyJwk(generateIdentityKeyPair().privateKey)
    );
    const identity = await backup("new-stored-hash");
    const resolved4 = await bootstrapMessageIdentity(
      "reset",
      api(identity).options
    );
    expect(resolved4.status).toBe("ready");
  });
});
