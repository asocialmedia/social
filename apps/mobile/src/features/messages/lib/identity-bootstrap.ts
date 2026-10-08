import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { fetchIdentity, saveIdentity } from "@/features/messages/lib/client";
import type { MessageIdentityPayload } from "@/features/messages/lib/client";
import {
  KDF_ITERATIONS,
  decryptWithMasterKey,
  deriveMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  getStoredAccountSecret,
  getStoredPrivateKey,
  hashAccountSecret,
  importPrivateKeyJwk,
  publicKeyJwkToBase64,
  publicKeyBase64ToJwk,
  setStoredPrivateKey,
} from "@/features/messages/lib/crypto";
import {
  base64ToBytes,
  bytesToBase64,
  randomBytes,
} from "@/features/messages/lib/crypto-primitives";
import type { EcdhPrivateKey } from "@/features/messages/lib/crypto-primitives";

export interface ResolvedMessageIdentity {
  identity: { publicKey: string };
  privateKey: EcdhPrivateKey | null;
  status: "locked" | "ready";
}

// The server stores the encrypted private key as "<iv>.<ciphertext>".
function splitPrivateKey(stored: string): { ciphertext: string; iv: string } {
  const separator = stored.indexOf(".");
  if (separator === -1) {
    throw new Error("Malformed encrypted private key");
  }
  return {
    ciphertext: stored.slice(separator + 1),
    iv: stored.slice(0, separator),
  };
}

// Unwraps the stored private key with a master key derived from `material`.
// Shared by the automatic and verifier paths so both cross the same trust
// boundary and produce the same JWK.
async function recoverPrivateKey(
  identity: MessageIdentityPayload,
  material: string,
  userId: string
): Promise<EcdhPrivateKey> {
  const masterKey = await deriveMasterKey(
    material,
    base64ToBytes(identity.salt),
    identity.kdfIterations
  );
  const { ciphertext, iv } = splitPrivateKey(identity.encryptedPrivateKey);
  const jwk = JSON.parse(
    await decryptWithMasterKey(masterKey, { ciphertext, iv })
  ) as JsonWebKey;
  const privateKey = importPrivateKeyJwk(jwk);
  await setStoredPrivateKey(userId, jwk);
  return privateKey;
}

// A rapid leave/re-enter or Strict Mode remount shares the same operation.
// Fresh-device provisioning must not race two keypairs against one identity row.
const bootstraps = new Map<string, Promise<ResolvedMessageIdentity>>();

export function bootstrapMessageIdentity(
  userId: string,
  options: ApiCallOptions
): Promise<ResolvedMessageIdentity> {
  const current = bootstraps.get(userId);
  if (current) {
    return current;
  }
  const pending = resolveIdentity(userId, options);
  bootstraps.set(userId, pending);
  void releaseBootstrap(userId, pending);
  return pending;
}

async function releaseBootstrap(
  userId: string,
  pending: Promise<ResolvedMessageIdentity>
): Promise<void> {
  try {
    await pending;
  } catch {
    // The caller reports failures; this observer only releases the shared job.
  } finally {
    if (bootstraps.get(userId) === pending) {
      bootstraps.delete(userId);
    }
  }
}

async function resolveIdentity(
  userId: string,
  options: ApiCallOptions
): Promise<ResolvedMessageIdentity> {
  const { identity } = await fetchIdentity(options);

  if (identity) {
    // A stored row means a returning device.
    const localJwk = await getStoredPrivateKey(userId);
    if (localJwk) {
      try {
        const privateKey = importPrivateKeyJwk(localJwk);
        const actual = exportPrivateKeyJwk(privateKey);
        const stored = publicKeyBase64ToJwk(identity.publicKey);
        if (actual.x === stored.x && actual.y === stored.y) {
          return {
            identity: { publicKey: identity.publicKey },
            privateKey,
            status: "ready",
          };
        }
      } catch {
        // Corrupt or superseded local keys recover from the stored row.
      }
    }

    // Invariant 1 first: recover from the stored row alone, no user input.
    try {
      const recovered = await recoverPrivateKey(
        identity,
        identity.masterKeyHash,
        userId
      );
      return {
        identity: { publicKey: identity.publicKey },
        privateKey: recovered,
        status: "ready",
      };
    } catch {
      // Fall through to invariant 2 before giving up.
    }

    // Invariant 2: a verifier row cannot be auto-recovered, but this device
    // may still hold the raw secret it was derived from.
    const verifierSecret = await getStoredAccountSecret(userId);
    if (verifierSecret) {
      try {
        const matches =
          (await hashAccountSecret(verifierSecret)) === identity.masterKeyHash;
        if (matches) {
          const unlocked = await recoverPrivateKey(
            identity,
            verifierSecret,
            userId
          );
          return {
            identity: { publicKey: identity.publicKey },
            privateKey: unlocked,
            status: "ready",
          };
        }
      } catch {
        // A stored secret that does not open this row is no help; fall
        // through to locked.
      }
    }

    // Invariant 3: the row exists but nothing on this device can read it.
    // That is `locked` with a reset, never a dead end.
    return {
      identity: { publicKey: identity.publicKey },
      privateKey: null,
      status: "locked",
    };
  }

  // No row: provision. Nothing exists to preserve, so this is the only
  // moment a key is generated.
  const { privateKey, publicKey } = generateIdentityKeyPair();
  const salt = bytesToBase64(randomBytes(16));
  // The raw secret is hashed and discarded: the PBKDF2 input is the HASH, so
  // the stored row alone re-derives the backup key.
  const masterKeyHash = await hashAccountSecret(generateAccountSecret());
  const masterKey = await deriveMasterKey(
    masterKeyHash,
    base64ToBytes(salt),
    KDF_ITERATIONS
  );
  const encryptedPrivateKey = await encryptWithMasterKey(
    masterKey,
    JSON.stringify(exportPrivateKeyJwk(privateKey))
  );
  const publicKeyEncoded = publicKeyJwkToBase64(exportPublicKeyJwk(publicKey));
  await saveIdentity(
    {
      encryptedPrivateKey: `${encryptedPrivateKey.iv}.${encryptedPrivateKey.ciphertext}`,
      kdfIterations: KDF_ITERATIONS,
      masterKeyHash,
      publicKey: publicKeyEncoded,
      salt,
    },
    options
  );
  // Cached locally too, so the next mount skips the PBKDF2 entirely.
  await setStoredPrivateKey(userId, exportPrivateKeyJwk(privateKey));
  return {
    identity: { publicKey: publicKeyEncoded },
    privateKey,
    status: "ready",
  };
}
