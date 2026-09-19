import { describe, expect, test } from "bun:test";

import {
  decryptWithMasterKey,
  deriveBackupKeyFromPrf,
  deriveMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  hashAccountSecret,
  importPrivateKeyJwk,
} from "./crypto";
import { buildPasskeyBackup } from "./recovery-enroll";

// The properties the messages recovery design promises. Each one encodes an
// incident: an account that could not be recovered, a backup a server reader
// could decrypt, or a reset that destroyed the peer's history. They are the
// regression net for the rules in AGENTS.md.

const KDF_ITERATIONS = 100_000;

function prfOutput(): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

describe("messages recovery invariants", () => {
  test("a fresh device recovers with no typed secret when a passkey is enrolled", async () => {
    // Device A: provision, then enroll a recovery credential. The PRF output
    // stands in for the authenticator's stable response.
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const manualSecret = generateAccountSecret();
    const manualHash = await hashAccountSecret(manualSecret);
    const manualKey = await deriveMasterKey(manualSecret, salt, KDF_ITERATIONS);
    const manualBackup = await encryptWithMasterKey(
      manualKey,
      JSON.stringify(privateKeyJwk)
    );

    // The single stored row after enrolling: a PRF copy ADDED to the manual one.
    const prf = prfOutput();
    const passkeyBackup = await buildPasskeyBackup({
      identity: {
        encryptedPrivateKey: `${manualBackup.iv}.${manualBackup.ciphertext}`,
        kdfIterations: KDF_ITERATIONS,
        masterKeyHash: manualHash,
        publicKey: "pub",
        salt: btoa(String.fromCodePoint(...salt)),
      },
      prfOutput: prf,
      privateKey: pair.privateKey,
    });

    // Device B: has NO local storage and NO typed secret. The platform returns
    // the same PRF output for the synced credential, which is all it needs.
    const recoveredKey = await deriveBackupKeyFromPrf(
      prf,
      salt,
      KDF_ITERATIONS
    );
    const [iv, ciphertext] = passkeyBackup.prfEncryptedPrivateKey.split(".");
    const decrypted = await decryptWithMasterKey(recoveredKey, {
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

  test("enrolling a passkey keeps the manual secret working", async () => {
    // The dual-backup guarantee: a device that only holds the recovery secret
    // must still unlock after another device enrolls a passkey. Enrolling
    // therefore must not re-encrypt the manual copy.
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const manualSecret = generateAccountSecret();
    const manualKey = await deriveMasterKey(manualSecret, salt, KDF_ITERATIONS);
    const manualBackup = await encryptWithMasterKey(
      manualKey,
      JSON.stringify(privateKeyJwk)
    );

    await buildPasskeyBackup({
      identity: {
        encryptedPrivateKey: `${manualBackup.iv}.${manualBackup.ciphertext}`,
        kdfIterations: KDF_ITERATIONS,
        masterKeyHash: await hashAccountSecret(manualSecret),
        publicKey: "pub",
        salt: btoa(String.fromCodePoint(...salt)),
      },
      prfOutput: prfOutput(),
      privateKey: pair.privateKey,
    });

    // The original manual ciphertext is untouched, so the secret still unlocks.
    const stillWorks = await decryptWithMasterKey(manualKey, manualBackup);
    expect(JSON.parse(stillWorks)).toEqual(privateKeyJwk);
  });

  test("the server-held row cannot decrypt either backup", async () => {
    // Everything a database reader has: both ciphertexts, the IVs, the salt,
    // the iteration count, and the verifier hashes. Deriving from the stored
    // verifier (the legacy scheme) must fail for both copies.
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const manualSecret = generateAccountSecret();
    const manualVerifier = await hashAccountSecret(manualSecret);
    const manualKey = await deriveMasterKey(manualSecret, salt, KDF_ITERATIONS);
    const manualBackup = await encryptWithMasterKey(
      manualKey,
      JSON.stringify(privateKeyJwk)
    );
    const prf = prfOutput();
    const passkeyBackup = await buildPasskeyBackup({
      identity: {
        encryptedPrivateKey: `${manualBackup.iv}.${manualBackup.ciphertext}`,
        kdfIterations: KDF_ITERATIONS,
        masterKeyHash: manualVerifier,
        publicKey: "pub",
        salt: btoa(String.fromCodePoint(...salt)),
      },
      prfOutput: prf,
      privateKey: pair.privateKey,
    });

    const fromManualVerifier = await deriveMasterKey(
      manualVerifier,
      salt,
      KDF_ITERATIONS
    );
    await expect(
      decryptWithMasterKey(fromManualVerifier, manualBackup)
    ).rejects.toThrow();

    const [iv, ciphertext] = passkeyBackup.prfEncryptedPrivateKey.split(".");
    const fromPrfVerifier = await deriveMasterKey(
      passkeyBackup.prfVerifier,
      salt,
      KDF_ITERATIONS
    );
    await expect(
      decryptWithMasterKey(fromPrfVerifier, {
        ciphertext: ciphertext as string,
        iv: iv as string,
      })
    ).rejects.toThrow();
  });
});
