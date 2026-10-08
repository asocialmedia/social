import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMasterKey,
  encryptMessage,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  generateRootKey,
  hashAccountSecret,
  importPrivateKeyJwk,
  publicKeyJwkToBase64,
  unwrapRootKey,
  wrapRootKey,
} from "./crypto";
import type { EncryptedBlob } from "./crypto";

// The properties the messages recovery design promises now that the backup key
// is derived from the stored row (server-recoverable, "Telegram-cloud"
// semantics): a new device always recovers with no input, the reset path loses
// only the resetting account's history, and a versioned conversation-key wrap
// keeps the peer's older epochs readable. They are the regression net for the
// rules in AGENTS.md.
//
// The same three hold for a den, where "the peer" is every other member and the
// recovery has to survive an epoch fanned out to a hundred of them. The den cases
// are at the bottom of the file, run against the same primitives the group path
// uses: an identity recovered from the stored row alone, and a per-member wrap.

const KDF_ITERATIONS = 100_000;
const DEN_ID = "den-recovery";

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

async function memberPublicKeys(count: number) {
  const pairs: CryptoKeyPair[] = [];
  const generated = await Promise.all(
    Array.from({ length: count }, () => generateIdentityKeyPair())
  );
  for (const pair of generated) {
    pairs.push(pair);
  }
  return pairs;
}

// Recovers the private key from what the server stores and nothing else. This is
// the whole recovery story: no local storage, no user input, no credential.
async function recoverPrivateKey(row: {
  backup: EncryptedBlob;
  masterKeyHash: string;
  salt: Uint8Array;
}): Promise<CryptoKey> {
  const masterKey = await deriveMasterKey(
    row.masterKeyHash,
    row.salt,
    KDF_ITERATIONS
  );
  const decrypted = await decryptWithMasterKey(masterKey, row.backup);
  return await importPrivateKeyJwk(JSON.parse(decrypted) as JsonWebKey);
}

// The abandoned verifier scheme: the row holds only the HASH of the secret, so
// the key comes from the raw secret this device still has. Kept read-only, and
// kept, because otherwise those rows would be stranded by the reset path. Mirrors
// the device-secret attempt in the provider's unlockIdentity.
async function unlockVerifierRow(
  row: { backup: EncryptedBlob; masterKeyHash: string; salt: Uint8Array },
  secret: string
): Promise<CryptoKey> {
  const verifier = await hashAccountSecret(secret);
  if (verifier.toLowerCase() !== row.masterKeyHash.toLowerCase()) {
    throw new Error("Verifier mismatch");
  }
  const masterKey = await deriveMasterKey(secret, row.salt, KDF_ITERATIONS);
  const decrypted = await decryptWithMasterKey(masterKey, row.backup);
  return await importPrivateKeyJwk(JSON.parse(decrypted) as JsonWebKey);
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

// The same three rules, in a den. "The peer" is now every other member, the epoch
// is fanned out to all of them, and recovery has to survive a wrap that was made
// by somebody else entirely — so each case here drives the actual wrap primitives
// rather than asserting on shapes.
describe("messages recovery invariants in a den", () => {
  // An epoch, fanned out: one root key, one independent wrap per member, each
  // paired with the member alone. Mirrors what the client posts for one version.
  async function fanOutEpoch(
    rootKey: Uint8Array,
    rotator: CryptoKeyPair,
    members: readonly CryptoKeyPair[]
  ) {
    return await Promise.all(
      members.map(
        async (member) =>
          await wrapRootKey(
            rotator.privateKey,
            member.publicKey,
            DEN_ID,
            rootKey
          )
      )
    );
  }

  test("a fresh device recovers its den epoch from the stored row alone", async () => {
    // Invariant 1, group version. A member's den epoch was wrapped by somebody
    // else, so recovering it means recovering THEIR wrap's pairing partner — this
    // member's own key — out of this member's identity row, with no local storage
    // and nothing typed. Still automatic.
    const rows = await provision();
    const [rotator, ...others] = await memberPublicKeys(4);
    if (!rotator) {
      throw new Error("expected a rotator");
    }
    const rootKey = generateRootKey();
    // Four members, the recovered one among them: this member's row and the wrap
    // made for them are the two halves that have to meet again after a wipe.
    const [mine] = await fanOutEpoch(rootKey, rotator, [rows.pair, ...others]);
    const message = await encryptMessage(rootKey, "sender-1", 0, DEN_ID, {
      content: "den history",
      type: "text",
    });

    // Device B, wiped. The only input is the identity row.
    const recovered = await recoverPrivateKey(rows);
    const recoveredJwk = await exportPrivateKeyJwk(recovered);
    const originalJwk = await exportPublicKeyJwk(rows.pair.publicKey);
    expect(recoveredJwk.x).toBe(originalJwk.x);
    expect(recoveredJwk.y).toBe(originalJwk.y);

    // With the recovered key the member unwraps the epoch somebody else wrapped
    // for them, and reads the den's history. The pairing is (this member's
    // recovered private key, the ROTATOR's public key): ECDH is symmetric, so that
    // is the same secret the rotator paired with this member's public key.
    const unwrapped = await unwrapRootKey(
      recovered,
      rotator.publicKey,
      DEN_ID,
      mine ?? { ciphertext: "", iv: "" }
    );
    expect(
      await decryptMessage(unwrapped, "sender-1", DEN_ID, message)
    ).toEqual({ content: "den history", type: "text" });
  });

  test("a verifier identity still unlocks a den epoch from its device secret", async () => {
    // Invariant 2, group version. The short-lived verifier scheme cannot be
    // re-derived from the row, so it only unlocks on a device that still holds the
    // raw secret — and a den member who unlocks that way must still be able to
    // read the epochs already wrapped for them. That attempt is kept in the
    // provider's unlockIdentity precisely so these rows are not stranded.
    const pair = await generateIdentityKeyPair();
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const secret = generateAccountSecret();
    const masterKeyHash = await hashAccountSecret(secret);
    const masterKey = await deriveMasterKey(secret, salt, KDF_ITERATIONS);
    const backup = await encryptWithMasterKey(
      masterKey,
      JSON.stringify(privateKeyJwk)
    );

    // Device B lost local storage but the user still has the saved secret, so the
    // verifier is checked against the stored hash and the key derived from the RAW
    // secret rather than the hash.
    const unlockedKey = await unlockVerifierRow(
      { backup, masterKeyHash, salt },
      secret
    );

    const [rotator] = await memberPublicKeys(2);
    const rootKey = generateRootKey();
    const [mine] = await fanOutEpoch(rootKey, rotator ?? pair, [pair]);
    const unwrapped = await unwrapRootKey(
      unlockedKey,
      rotator?.publicKey ?? pair.publicKey,
      DEN_ID,
      mine ?? { ciphertext: "", iv: "" }
    );
    expect(Buffer.from(unwrapped).equals(Buffer.from(rootKey))).toBe(true);
  });

  test("a lost key costs only that member their own den history", async () => {
    // Invariant 3, group version, and the one a fan-out makes interesting: the
    // resetter loses the epochs wrapped for their OLD identity, and nothing else
    // moves. The other members keep every wrap they had (their epochs were never
    // overwritten or deleted, they were only added to), and the resetter heals
    // forward with a fresh epoch that leaves the group's history intact.
    const lost = await provision();
    const [rotator, survivorA, survivorB] = await memberPublicKeys(3);
    const oldRoot = generateRootKey();
    const oldWraps = await fanOutEpoch(oldRoot, rotator ?? lost.pair, [
      lost.pair,
      survivorA ?? lost.pair,
      survivorB ?? lost.pair,
    ]);
    const oldMessage = await encryptMessage(oldRoot, "rotator", 0, DEN_ID, {
      content: "before the reset",
      type: "text",
    });

    // The reset: a brand new keypair and a new row. The old row is unreadable to
    // it, and the old wraps were paired with the old public key.
    const fresh = await provision();
    await expect(
      unwrapRootKey(
        fresh.pair.privateKey,
        rotator?.publicKey ?? fresh.pair.publicKey,
        DEN_ID,
        oldWraps[0] ?? { ciphertext: "", iv: "" }
      )
    ).rejects.toThrow();

    // Every other member still reads the pre-reset den history from the wraps they
    // already hold. Nothing about one member's reset erases the group's.
    const survivors = [survivorA, survivorB].filter(
      (survivor): survivor is CryptoKeyPair => survivor !== undefined
    );
    const survivorReads = await Promise.all(
      survivors.map(
        async (survivor, index) =>
          await decryptMessage(
            await unwrapRootKey(
              survivor.privateKey,
              rotator?.publicKey ?? survivor.publicKey,
              DEN_ID,
              oldWraps[index + 1] ?? { ciphertext: "", iv: "" }
            ),
            "rotator",
            DEN_ID,
            oldMessage
          )
      )
    );
    expect(survivorReads).toHaveLength(2);
    for (const payload of survivorReads) {
      expect(payload).toEqual({ content: "before the reset", type: "text" });
    }

    // And the resetter is not stranded: a fresh epoch, wrapped by their new key for
    // the whole roster, restores their read access going forward while the old
    // epoch stays readable to everyone else. This is the version bump, not an
    // overwrite — the old wraps above are still exactly as they were.
    const newRoot = generateRootKey();
    const newWraps = await fanOutEpoch(newRoot, fresh.pair, [
      fresh.pair,
      survivorA ?? fresh.pair,
      survivorB ?? fresh.pair,
    ]);
    const newMessage = await encryptMessage(
      newRoot,
      "reset-member",
      0,
      DEN_ID,
      {
        content: "after the reset",
        type: "text",
      }
    );
    const healed = await unwrapRootKey(
      fresh.pair.privateKey,
      fresh.pair.publicKey,
      DEN_ID,
      newWraps[0] ?? { ciphertext: "", iv: "" }
    );
    expect(
      await decryptMessage(healed, "reset-member", DEN_ID, newMessage)
    ).toEqual({ content: "after the reset", type: "text" });
    // A member outside the new epoch still cannot read what came after it, and the
    // pre-reset epoch it was never given is still gone for the resetter.
    const outsider = await generateIdentityKeyPair();
    await expect(
      unwrapRootKey(
        outsider.privateKey,
        fresh.pair.publicKey,
        DEN_ID,
        newWraps[1] ?? { ciphertext: "", iv: "" }
      )
    ).rejects.toThrow();
    expect(newWraps).toHaveLength(3);
    expect(oldWraps).toHaveLength(3);
  });

  test("a den wrap is bound to the den, not to any member's other thread", async () => {
    // The wrap key is derived per conversation, so the same fan-out cannot be
    // replayed into another den. A group that shares a root key with a stranger
    // would break the whole membership model, and this is what prevents it.
    const rotator = await generateIdentityKeyPair();
    const member = await generateIdentityKeyPair();
    const rootKey = generateRootKey();
    const [mine] = await fanOutEpoch(rootKey, rotator, [member]);
    await expect(
      unwrapRootKey(
        member.privateKey,
        rotator.publicKey,
        "other-den",
        mine ?? {
          ciphertext: "",
          iv: "",
        }
      )
    ).rejects.toThrow();
  });

  test("a member's den wrap is unusable by every other member", async () => {
    // Membership is the gate: within one den, a wrap is paired with the one member
    // it was made for, so another member of the same den cannot unwrap it even
    // though they are in the room and hold the same epoch by their own route.
    const rotator = await generateIdentityKeyPair();
    const [alice, bob] = await memberPublicKeys(2);
    const rootKey = generateRootKey();
    const wraps = await fanOutEpoch(rootKey, rotator, [alice, bob]);
    await expect(
      unwrapRootKey(
        bob.privateKey,
        rotator.publicKey,
        DEN_ID,
        wraps[0] ?? { ciphertext: "", iv: "" }
      )
    ).rejects.toThrow();
    // Public key material is what a wrap row stores; the snapshot a member is
    // left holding after leaving is their public half and nothing more.
    expect(
      typeof publicKeyJwkToBase64(await exportPublicKeyJwk(bob.publicKey))
    ).toBe("string");
  });
});

// Invariant 2 has a source-level half that no amount of crypto testing can reach:
// the provider must KEEP the attempt to unlock an abandoned verifier row from the
// secret this device still holds, and must never grow a user-facing credential on
// top of it. Recovery is server-side, so a passkey or a PRF would be pure
// ceremony over a row that is already readable by the database operator.
describe("the device-secret unlock attempt is kept", () => {
  const providerPath = path.join(
    import.meta.dirname,
    "..",
    "..",
    "components",
    "messages",
    "message-identity-provider.tsx"
  );
  const identityBackupPath = path.join(
    import.meta.dirname,
    "identity-backup.ts"
  );

  test("unlockIdentity still tries the device secret, and derives from it", async () => {
    const [provider, source] = await Promise.all([
      readFile(providerPath, "utf-8"),
      readFile(identityBackupPath, "utf-8"),
    ]);
    // The raw secret this device holds, verified against the stored hash and then
    // used as the KDF input.
    expect(provider).toContain("getStoredAccountSecret");
    expect(provider).toContain("unlockAndMigrateIdentityBackup");
    expect(source).toMatch(/deriveMasterKey\(\s*deviceSecret\s*,/);
    // And the row-alone derivation, which is what makes recovery automatic.
    expect(source).toMatch(/deriveMasterKey\(\s*identity\.masterKeyHash\s*,/);
    expect(source).toContain("refreshLegacyIdentityBackup");
  });

  test("no user-facing credential is bolted onto identity recovery", async () => {
    const raw = await readFile(providerPath, "utf-8");
    const source = raw.toLowerCase();
    // A passkey or a PRF credential would re-introduce the user-facing secret the
    // design deliberately removed, and would make recovery depend on hardware the
    // server does not have. Matched case-insensitively on the exact WebAuthn
    // surface, so ordinary identity-key names (publicKey, exportPublicKeyJwk) do
    // not trip it.
    for (const forbidden of [
      "navigator.credentials",
      "publickeycredential",
      "createcredential",
      // A PRF credential still has to be fetched through getPublicKey, so this
      // covers it without matching ordinary words that merely contain "prf".
      "getpublickey",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
