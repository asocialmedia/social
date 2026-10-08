import { describe, expect, test } from "bun:test";

import type { MessageIdentityPayload } from "./client";
import {
  decryptWithMasterKey,
  deriveMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  hashAccountSecret,
  importPrivateKeyJwk,
  publicKeyJwkToBase64,
} from "./crypto";
import {
  createRecoverableIdentityBackup,
  refreshLegacyIdentityBackup,
  unlockAndMigrateIdentityBackup,
  unlockIdentityBackup,
} from "./identity-backup";

function encodeBytes(bytes: Uint8Array): string {
  return btoa(String.fromCodePoint(...bytes));
}

function decodeBytes(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (character) =>
    character.codePointAt(0)
  );
}

async function makeIdentity(
  privateKeyJwk: JsonWebKey,
  publicKey: string,
  backupSecret: string,
  verifierRow: boolean
): Promise<MessageIdentityPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const masterKeyHash = await hashAccountSecret(backupSecret);
  const masterKey = await deriveMasterKey(
    verifierRow ? backupSecret : masterKeyHash,
    salt,
    100_000
  );
  const backup = await encryptWithMasterKey(
    masterKey,
    JSON.stringify(privateKeyJwk)
  );
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
    kdfIterations: 100_000,
    masterKeyHash,
    publicKey,
    salt: encodeBytes(salt),
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

describe("identity backup recovery and refresh", () => {
  test("unlocks a legacy verifier backup and refreshes it without changing the keypair", async () => {
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const publicKey = publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    );
    const deviceSecret = generateAccountSecret();
    const identity = await makeIdentity(
      privateKeyJwk,
      publicKey,
      deviceSecret,
      true
    );

    const unlocked = await unlockIdentityBackup(identity, deviceSecret);
    expect(unlocked.usedLegacyVerifier).toBe(true);
    expect(unlocked.privateKey.type).toBe("private");

    const refreshed = await createRecoverableIdentityBackup(
      identity,
      unlocked.privateKeyJwk
    );
    expect(refreshed.publicKey).toBe(identity.publicKey);
    expect(refreshed.expectedUpdatedAt).toBe(identity.updatedAt);
    expect(refreshed.masterKeyHash).not.toBe(identity.masterKeyHash);

    const [iv, ciphertext] = refreshed.encryptedPrivateKey.split(".");
    const masterKey = await deriveMasterKey(
      refreshed.masterKeyHash,
      decodeBytes(refreshed.salt),
      refreshed.kdfIterations
    );
    const decrypted = await decryptWithMasterKey(masterKey, {
      ciphertext: ciphertext ?? "",
      iv: iv ?? "",
    });
    const recoveredKey = await importPrivateKeyJwk(JSON.parse(decrypted));
    expect(publicKeyJwkToBase64(await exportPublicKeyJwk(recoveredKey))).toBe(
      identity.publicKey
    );
  });

  test("keeps automatic stored-row recovery for current backups", async () => {
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const publicKey = publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    );
    const identity = await makeIdentity(
      privateKeyJwk,
      publicKey,
      generateAccountSecret(),
      false
    );

    const unlocked = await unlockIdentityBackup(identity, "old-device-secret");

    expect(unlocked.usedLegacyVerifier).toBe(false);
    expect(
      publicKeyJwkToBase64(await exportPublicKeyJwk(unlocked.privateKey))
    ).toBe(identity.publicKey);
  });

  test("persists a legacy unlock before refreshing and treats refresh failure as recoverable", async () => {
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const publicKey = publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    );
    const deviceSecret = generateAccountSecret();
    const identity = await makeIdentity(
      privateKeyJwk,
      publicKey,
      deviceSecret,
      true
    );
    const order: string[] = [];

    const unlocked = await unlockAndMigrateIdentityBackup(
      identity,
      deviceSecret,
      {
        persist: () => {
          order.push("persist");
        },
        refresh: () => {
          order.push("refresh");
          throw new Error("temporary network failure");
        },
      }
    );

    expect(order).toEqual(["persist", "refresh"]);
    expect(unlocked.usedLegacyVerifier).toBe(true);
    expect(unlocked.refreshedIdentity).toBeNull();
    expect(
      publicKeyJwkToBase64(await exportPublicKeyJwk(unlocked.privateKey))
    ).toBe(identity.publicKey);
  });

  test("returns the refreshed identity only after the server compare-and-swap succeeds", async () => {
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const publicKey = publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    );
    const deviceSecret = generateAccountSecret();
    const identity = await makeIdentity(
      privateKeyJwk,
      publicKey,
      deviceSecret,
      true
    );
    const nextUpdatedAt = "2026-01-02T00:00:00.001Z";

    const unlocked = await unlockAndMigrateIdentityBackup(
      identity,
      deviceSecret,
      {
        persist: async () => {},
        refresh: (payload) => {
          expect(payload.publicKey).toBe(identity.publicKey);
          expect(payload.expectedUpdatedAt).toBe(identity.updatedAt);
          return { updatedAt: nextUpdatedAt };
        },
      }
    );

    expect(unlocked.refreshedIdentity).toMatchObject({
      publicKey: identity.publicKey,
      updatedAt: nextUpdatedAt,
    });
    expect(unlocked.refreshedIdentity?.masterKeyHash).not.toBe(
      identity.masterKeyHash
    );
  });

  test("does not refresh current stored-row backups", async () => {
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const publicKey = publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    );
    const identity = await makeIdentity(
      privateKeyJwk,
      publicKey,
      generateAccountSecret(),
      false
    );
    let refreshCalls = 0;

    const unlocked = await unlockAndMigrateIdentityBackup(identity, null, {
      persist: async () => {},
      refresh: () => {
        refreshCalls += 1;
        return { updatedAt: identity.updatedAt };
      },
    });

    expect(refreshCalls).toBe(0);
    expect(unlocked.refreshedIdentity).toBeNull();
  });

  test("retries legacy refresh when the device already has a cached private key", async () => {
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const publicKey = publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    );
    const deviceSecret = generateAccountSecret();
    const identity = await makeIdentity(
      privateKeyJwk,
      publicKey,
      deviceSecret,
      true
    );
    let refreshCalls = 0;

    const refreshed = await refreshLegacyIdentityBackup(
      identity,
      deviceSecret,
      privateKeyJwk,
      (payload) => {
        refreshCalls += 1;
        expect(payload.expectedUpdatedAt).toBe(identity.updatedAt);
        return { updatedAt: "2026-01-02T00:00:00.001Z" };
      }
    );

    expect(refreshCalls).toBe(1);
    expect(refreshed?.updatedAt).toBe("2026-01-02T00:00:00.001Z");
    expect(refreshed?.publicKey).toBe(identity.publicKey);
    expect(refreshed?.masterKeyHash).not.toBe(identity.masterKeyHash);
  });

  test("refuses a backup private key that does not match the stored public key", async () => {
    const identityPair = await generateIdentityKeyPair();
    const backupPair = await generateIdentityKeyPair();
    const identity = await makeIdentity(
      await exportPrivateKeyJwk(backupPair.privateKey),
      publicKeyJwkToBase64(await exportPublicKeyJwk(identityPair.publicKey)),
      generateAccountSecret(),
      false
    );

    await expect(unlockIdentityBackup(identity, null)).rejects.toThrow(
      "does not match its public key"
    );
    await expect(
      createRecoverableIdentityBackup(
        identity,
        await exportPrivateKeyJwk(backupPair.privateKey)
      )
    ).rejects.toThrow("does not match its public key");
  });
});
