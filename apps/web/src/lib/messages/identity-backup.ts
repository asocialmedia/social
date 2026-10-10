import type { MessageIdentityPayload } from "./client";
import {
  KDF_ITERATIONS,
  decryptWithMasterKey,
  deriveMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  generateAccountSecret,
  hashAccountSecret,
  importPrivateKeyJwk,
  publicKeyJwkToBase64,
} from "./crypto";

export interface IdentityBackupRefreshInput {
  encryptedPrivateKey: string;
  expectedUpdatedAt: string;
  kdfIterations: number;
  masterKeyHash: string;
  publicKey: string;
  salt: string;
}

export interface UnlockedIdentityBackup {
  privateKey: CryptoKey;
  privateKeyJwk: JsonWebKey;
  usedLegacyVerifier: boolean;
}

export type RefreshIdentityBackup = (
  input: IdentityBackupRefreshInput
) => Promise<{ recoveryGeneration: number; updatedAt: string }>;

function isPrivateKeyJwk(value: unknown): value is JsonWebKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const jwk = value as Record<string, unknown>;
  return (
    jwk.crv === "P-256" &&
    jwk.kty === "EC" &&
    typeof jwk.d === "string" &&
    typeof jwk.x === "string" &&
    typeof jwk.y === "string"
  );
}

function decodeSalt(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
}

async function importMatchingPrivateKey(
  privateKeyJwk: JsonWebKey,
  expectedPublicKey: string
): Promise<CryptoKey> {
  const privateKey = await importPrivateKeyJwk(privateKeyJwk);
  const exported = await exportPrivateKeyJwk(privateKey);
  const actualPublicKey = publicKeyJwkToBase64({
    crv: exported.crv,
    kty: exported.kty,
    x: exported.x,
    y: exported.y,
  });
  if (actualPublicKey !== expectedPublicKey) {
    throw new Error("The identity backup does not match its public key");
  }
  return privateKey;
}

async function decryptPrivateKey(
  masterKey: CryptoKey,
  blob: { ciphertext: string; iv: string },
  expectedPublicKey: string
): Promise<{ privateKey: CryptoKey; privateKeyJwk: JsonWebKey }> {
  const plaintext = await decryptWithMasterKey(masterKey, blob);
  const parsed: unknown = JSON.parse(plaintext);
  if (!isPrivateKeyJwk(parsed)) {
    throw new Error("The identity backup is malformed");
  }
  const privateKey = await importMatchingPrivateKey(parsed, expectedPublicKey);
  return { privateKey, privateKeyJwk: await exportPrivateKeyJwk(privateKey) };
}

export async function unlockIdentityBackup(
  identity: MessageIdentityPayload,
  deviceSecret: string | null
): Promise<UnlockedIdentityBackup> {
  const salt = decodeSalt(identity.salt);
  const [iv, ciphertext, extra] = identity.encryptedPrivateKey.split(".");
  if (!iv || !ciphertext || extra !== undefined) {
    throw new Error("The identity backup is malformed");
  }

  if (deviceSecret) {
    try {
      const verifier = await hashAccountSecret(deviceSecret);
      if (verifier.toLowerCase() === identity.masterKeyHash.toLowerCase()) {
        const masterKey = await deriveMasterKey(
          deviceSecret,
          salt,
          identity.kdfIterations
        );
        const unlocked = await decryptPrivateKey(
          masterKey,
          { ciphertext, iv },
          identity.publicKey
        );
        return { ...unlocked, usedLegacyVerifier: true };
      }
    } catch {
      // A failed legacy attempt falls through to the recoverable row derivation.
    }
  }

  const masterKey = await deriveMasterKey(
    identity.masterKeyHash,
    salt,
    identity.kdfIterations
  );
  const unlocked = await decryptPrivateKey(
    masterKey,
    { ciphertext, iv },
    identity.publicKey
  );
  return { ...unlocked, usedLegacyVerifier: false };
}

export async function createRecoverableIdentityBackup(
  identity: MessageIdentityPayload,
  privateKeyJwk: JsonWebKey
): Promise<IdentityBackupRefreshInput> {
  const privateKey = await importMatchingPrivateKey(
    privateKeyJwk,
    identity.publicKey
  );
  const verifiedPrivateKeyJwk = await exportPrivateKeyJwk(privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const masterKeyHash = await hashAccountSecret(generateAccountSecret());
  const masterKey = await deriveMasterKey(masterKeyHash, salt, KDF_ITERATIONS);
  const backup = await encryptWithMasterKey(
    masterKey,
    JSON.stringify(verifiedPrivateKeyJwk)
  );
  return {
    encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
    expectedUpdatedAt: identity.updatedAt,
    kdfIterations: KDF_ITERATIONS,
    masterKeyHash,
    publicKey: identity.publicKey,
    salt: btoa(String.fromCodePoint(...salt)),
  };
}

export async function refreshLegacyIdentityBackup(
  identity: MessageIdentityPayload,
  deviceSecret: string | null,
  privateKeyJwk: JsonWebKey,
  refresh: RefreshIdentityBackup
): Promise<(MessageIdentityPayload & { recoveryGeneration: number }) | null> {
  if (!deviceSecret) {
    return null;
  }
  try {
    const verifier = await hashAccountSecret(deviceSecret);
    if (verifier.toLowerCase() !== identity.masterKeyHash.toLowerCase()) {
      return null;
    }
    const payload = await createRecoverableIdentityBackup(
      identity,
      privateKeyJwk
    );
    const result = await refresh(payload);
    return {
      ...identity,
      ...payload,
      recoveryGeneration: result.recoveryGeneration,
      updatedAt: result.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function unlockAndMigrateIdentityBackup(
  identity: MessageIdentityPayload,
  deviceSecret: string | null,
  dependencies: {
    persist: (
      privateKey: CryptoKey,
      privateKeyJwk: JsonWebKey
    ) => Promise<void>;
    refresh: RefreshIdentityBackup;
  }
): Promise<
  UnlockedIdentityBackup & {
    refreshedIdentity:
      | (MessageIdentityPayload & { recoveryGeneration: number })
      | null;
  }
> {
  const unlocked = await unlockIdentityBackup(identity, deviceSecret);
  await dependencies.persist(unlocked.privateKey, unlocked.privateKeyJwk);
  if (!unlocked.usedLegacyVerifier) {
    return { ...unlocked, refreshedIdentity: null };
  }
  const refreshedIdentity = await refreshLegacyIdentityBackup(
    identity,
    deviceSecret,
    unlocked.privateKeyJwk,
    dependencies.refresh
  );
  return { ...unlocked, refreshedIdentity };
}
