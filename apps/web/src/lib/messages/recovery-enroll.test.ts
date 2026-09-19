import { describe, expect, test } from "bun:test";

import {
  decryptWithMasterKey,
  deriveBackupKeyFromPrf,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateIdentityKeyPair,
  hashPrfOutput,
  importPrivateKeyJwk,
} from "./crypto";
import { buildPasskeyBackup } from "./recovery-enroll";

// A stand-in for a WebAuthn PRF output: 32 random bytes, the size authenticators
// return for the extension's first result.
function prfOutput(): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

function identityFields(salt: Uint8Array) {
  return {
    encryptedPrivateKey: "manual-iv.manual-ct",
    kdfIterations: 100_000,
    masterKeyHash: "a".repeat(64),
    publicKey: "pub",
    salt: btoa(String.fromCodePoint(...salt)),
  };
}

describe("buildPasskeyBackup", () => {
  test("produces a backup that the same PRF output can decrypt", async () => {
    const pair = await generateIdentityKeyPair();
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const identity = identityFields(salt);
    const prf = prfOutput();

    const backup = await buildPasskeyBackup({
      identity,
      prfOutput: prf,
      privateKey: pair.privateKey,
    });

    expect(backup.backupMethod).toBe("passkey-prf");
    // The verifier is a hash of the PRF output, never the output itself.
    expect(backup.prfVerifier).toBe(await hashPrfOutput(prf));
    expect(backup.prfVerifier).not.toBe(Buffer.from(prf).toString("base64url"));

    const [iv, ciphertext] = backup.prfEncryptedPrivateKey.split(".");
    const key = await deriveBackupKeyFromPrf(prf, salt, identity.kdfIterations);
    const decrypted = await decryptWithMasterKey(key, {
      ciphertext: ciphertext as string,
      iv: iv as string,
    });
    const recovered = await importPrivateKeyJwk(
      JSON.parse(decrypted) as JsonWebKey
    );
    const recoveredJwk = await exportPrivateKeyJwk(recovered);
    const originalPublic = await exportPublicKeyJwk(pair.publicKey);
    expect(recoveredJwk.x).toBe(originalPublic.x);
    expect(recoveredJwk.y).toBe(originalPublic.y);
  });

  test("a different PRF output cannot decrypt the backup", async () => {
    const pair = await generateIdentityKeyPair();
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const identity = identityFields(salt);

    const backup = await buildPasskeyBackup({
      identity,
      prfOutput: prfOutput(),
      privateKey: pair.privateKey,
    });
    const [iv, ciphertext] = backup.prfEncryptedPrivateKey.split(".");

    const wrongKey = await deriveBackupKeyFromPrf(
      prfOutput(),
      salt,
      identity.kdfIterations
    );
    await expect(
      decryptWithMasterKey(wrongKey, {
        ciphertext: ciphertext as string,
        iv: iv as string,
      })
    ).rejects.toThrow();
  });
});
