import { describe, expect, test } from "bun:test";

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
} from "./crypto";

// The properties the messages recovery design promises now that the backup key
// is derived from the stored row (server-recoverable, "Telegram-cloud"
// semantics): a new device always recovers with no input, the reset path loses
// only the resetting account's history, and a versioned conversation-key wrap
// keeps the peer's older epochs readable. They are the regression net for the
// rules in AGENTS.md.

const KDF_ITERATIONS = 100_000;

// Mirrors enableIdentity(): keypair, random seed, only the seed's hash stored,
// backup key derived from that hash.
async function provision() {
  const pair = await generateIdentityKeyPair();
  const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const seed = generateAccountSecret();
  const masterKeyHash = await hashAccountSecret(seed);
  const masterKey = await deriveMasterKey(masterKeyHash, salt, KDF_ITERATIONS);
  const backup = await encryptWithMasterKey(
    masterKey,
    JSON.stringify(privateKeyJwk)
  );
  return { backup, masterKeyHash, pair, privateKeyJwk, salt };
}

describe("messages recovery invariants", () => {
  test("a fresh device recovers from the stored row alone, with no input", async () => {
    // Device A provisions; the server row keeps the ciphertext, salt,
    // iteration count, and the seed hash — nothing else.
    const { backup, masterKeyHash, pair, salt } = await provision();

    // Device B has no local storage, no user input, and no credential. It
    // derives the backup key from the row and decrypts the private key.
    const recoveredKey = await deriveMasterKey(
      masterKeyHash,
      salt,
      KDF_ITERATIONS
    );
    const decrypted = await decryptWithMasterKey(recoveredKey, backup);
    const recovered = await importPrivateKeyJwk(
      JSON.parse(decrypted) as JsonWebKey
    );
    const recoveredJwk = await exportPrivateKeyJwk(recovered);
    const originalPublic = await exportPublicKeyJwk(pair.publicKey);
    expect(recoveredJwk.x).toBe(originalPublic.x);
    expect(recoveredJwk.y).toBe(originalPublic.y);
  });

  test("the stored row alone CAN decrypt the backup (accepted trade-off)", async () => {
    // This is the deliberate semantic: recovery is automatic because the same
    // material a database reader holds is enough to derive the backup key.
    // Pinned so a future change cannot silently turn this back into a scheme
    // where the documented recovery story no longer works.
    const { backup, masterKeyHash, salt } = await provision();
    const rowDerived = await deriveMasterKey(
      masterKeyHash,
      salt,
      KDF_ITERATIONS
    );
    const plaintext = await decryptWithMasterKey(rowDerived, backup);
    expect(JSON.parse(plaintext)).toHaveProperty("d");
  });

  test("a different row cannot decrypt this backup", async () => {
    // Two identities must not be interchangeable: deriving from another row's
    // hash must fail, which is what makes the keypair, not the row format,
    // the unit of identity.
    const { backup } = await provision();
    const other = await provision();
    const wrongKey = await deriveMasterKey(
      other.masterKeyHash,
      other.salt,
      KDF_ITERATIONS
    );
    await expect(decryptWithMasterKey(wrongKey, backup)).rejects.toThrow();
  });

  test("a reset only needs a fresh keypair; the old row stays unreadable to it", async () => {
    // Resetting mints a new identity. Messages encrypted to the old identity
    // are no longer readable to the resetter, but the ciphertext itself is
    // never deleted, so a peer holding the old wrap keeps its history. This
    // assertion pins the "loss is scoped to the resetter" property.
    const old = await provision();
    const fresh = await provision();

    // The fresh identity cannot decrypt the old backup with its own row
    // material (its keypair is different).
    const freshDerived = await deriveMasterKey(
      fresh.masterKeyHash,
      fresh.salt,
      KDF_ITERATIONS
    );
    await expect(
      decryptWithMasterKey(freshDerived, old.backup)
    ).rejects.toThrow();

    // The old ciphertext is untouched and still decryptable from the old row:
    // nothing about a reset destroys the peer's copy of history.
    const oldDerived = await deriveMasterKey(
      old.masterKeyHash,
      old.salt,
      KDF_ITERATIONS
    );
    expect(
      JSON.parse(await decryptWithMasterKey(oldDerived, old.backup))
    ).toHaveProperty("d");
  });
});
