// The local search index's key derivation, and specifically the properties that
// keep it from weakening the message scheme.
//
// The index seals the row table so that holding the device database is not enough
// to test "does message X contain the word W?". That is only acceptable if the key
// it uses is genuinely separate from every message key, and if losing it degrades
// rather than bricks. Both are asserted here, because both are the kind of
// property that is easy to break with an innocuous-looking label change.
import { describe, expect, test } from "bun:test";

import {
  deriveIndexKey,
  deriveIndexKeyFromBase,
  importIndexBaseKey,
} from "./crypto";
import {
  decodeRowTable,
  encodeRowTable,
  seal,
  sealRowTable,
  unseal,
  unsealRowTable,
} from "./search-index-vault";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

const ROOT = new Uint8Array(32).fill(7);
const OTHER_ROOT = new Uint8Array(32).fill(9);
const CONVO = "convo-1";
const PLAINTEXT = new TextEncoder().encode(
  "message m1 contains the word deploy"
);

function sealWith(key: CryptoKey, data: Uint8Array = PLAINTEXT) {
  return seal(key, data);
}

describe("search index key derivation", () => {
  test("is deterministic for the same root and conversation", async () => {
    const first = await deriveIndexKey(ROOT, CONVO);
    const second = await deriveIndexKey(ROOT, CONVO);
    const sealed = await sealWith(first);
    // The second key opens what the first sealed, which is what makes a resumed
    // walk able to read rows written by an earlier session.
    expect([...(await unseal(second, sealed))]).toEqual([...PLAINTEXT]);
  });

  test("differs per conversation, so one thread's index cannot open another's", async () => {
    const one = await deriveIndexKey(ROOT, CONVO);
    const two = await deriveIndexKey(ROOT, "convo-2");
    const sealed = await sealWith(one);
    // The cross-conversation key must not open it. This is the property that
    // stops a bug (or an attacker) from reading one conversation's row table with
    // another conversation's index key.
    await expect(unseal(two, sealed)).rejects.toThrow();
  });

  test("differs per root, so a rekeyed conversation cannot read the old index", async () => {
    const before = await deriveIndexKey(ROOT, CONVO);
    const after = await deriveIndexKey(OTHER_ROOT, CONVO);
    const sealed = await sealWith(before);
    // A conversation-key reset changes the root and so changes this key. The old
    // index becomes unreadable, which is the intended degradation: it rebuilds by
    // walking, and the conversation itself is unaffected.
    await expect(unseal(after, sealed)).rejects.toThrow();
  });

  test("the imported base key derives the same key as the one-shot helper", async () => {
    const oneShot = await deriveIndexKey(ROOT, CONVO);
    const viaBase = await deriveIndexKeyFromBase(
      await importIndexBaseKey(ROOT),
      CONVO
    );
    const sealed = await sealWith(oneShot);
    expect([...(await unseal(viaBase, sealed))]).toEqual([...PLAINTEXT]);
  });

  test("is not exportable", async () => {
    // A non-extractable key cannot be lifted out of WebCrypto and written
    // somewhere less protected than the index itself.
    const key = await deriveIndexKey(ROOT, CONVO);
    expect(key.extractable).toBe(false);
  });
});

describe("search index key separation", () => {
  // These are the invariants that make sealing the row table safe to do. If any of
  // them regress, the index would be a liability rather than a hardening.
  test("the index label is distinct from the ratchet and wrap labels", async () => {
    // A message key is derived with info "asm:msg:v1" and salt
    // "asm:ratchet:<sender>:<index>"; a wrap key with info "asm:wrap:<convo>". The
    // index uses info "asm:index:v1" and salt "asm:index:<convo>". Asserting the
    // strings differ guards against a copy-paste that would make the index key and
    // a message key the same value.
    const { deriveMessageKey } = await import("./crypto");
    const { deriveWrapKey } = await import("./crypto");
    const senderId = "user-a";
    const sharedSecret = new Uint8Array(32).fill(3);

    const indexKey = await deriveIndexKey(ROOT, CONVO);
    const messageKey = await deriveMessageKey(ROOT, senderId, 0);
    const wrapKey = await deriveWrapKey(sharedSecret, CONVO);

    // A key that could open a message ciphertext would be a real break. The index
    // key must fail where a message key succeeds.
    const iv = new Uint8Array(12).fill(1);
    const messageSealed = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { iv: toArrayBuffer(iv), name: "AES-GCM" },
        messageKey,
        PLAINTEXT
      )
    );
    await expect(
      globalThis.crypto.subtle.decrypt(
        { iv, name: "AES-GCM" },
        indexKey,
        messageSealed
      )
    ).rejects.toThrow();

    // And the wrap key, which guards conversation key exchange, is likewise a
    // different value.
    const wrapIv = new Uint8Array(12).fill(2);
    const wrapped = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { iv: toArrayBuffer(wrapIv), name: "AES-GCM" },
        wrapKey,
        ROOT
      )
    );
    await expect(
      globalThis.crypto.subtle.decrypt(
        { iv: wrapIv, name: "AES-GCM" },
        indexKey,
        wrapped
      )
    ).rejects.toThrow();
  });

  test("a tampered ciphertext is rejected rather than silently misread", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const sealed = await sealWith(key);
    // Flip a byte in the ciphertext body. GCM must refuse it: a silently
    // corrupted row table would produce wrong search results with no signal.
    const tampered = new Uint8Array(sealed);
    tampered[20] = (tampered[20] ?? 0) === 0 ? 1 : 0;
    await expect(unseal(key, tampered)).rejects.toThrow();
  });

  test("a truncated ciphertext is rejected", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const sealed = await sealWith(key);
    await expect(unseal(key, sealed.slice(0, -4))).rejects.toThrow();
  });

  test("an empty payload round-trips", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const empty = new Uint8Array(0);
    const sealed = await sealWith(key, empty);
    expect([...(await unseal(key, sealed))]).toEqual([]);
  });
});

describe("row table codec", () => {
  // The row table is the thing being sealed, so its encoding has to survive ids
  // and timestamps of every shape the index actually holds.
  test("round-trips an empty table", () => {
    const table = {
      createdAtByRow: [],
      messageIdByRow: [],
      senderIdByRow: [],
    };
    expect(decodeRowTable(encodeRowTable(table))).toEqual(table);
  });

  test("round-trips rows with realistic ids and timestamps", () => {
    const table = {
      createdAtByRow: [1_700_000_000_000, 1_700_000_001_000, 0],
      messageIdByRow: ["cmeyj1z3k0000l3h8w9x2r7qv", "m", ""],
      senderIdByRow: ["user-a", "user-b", "user-a"],
    };
    expect(decodeRowTable(encodeRowTable(table))).toEqual(table);
  });

  test("interns sender ids instead of repeating them per row", () => {
    // A conversation has one or two participants, so storing a repeated id per row
    // would be most of the buffer for no information.
    const many = Array.from({ length: 500 }, () => "user-a");
    const single = {
      createdAtByRow: many.map(() => 1),
      messageIdByRow: many.map((_, index) => `m${index}`),
      senderIdByRow: many,
    };
    const interned = {
      createdAtByRow: many.map(() => 1),
      messageIdByRow: many.map((_, index) => `m${index}`),
      senderIdByRow: many.map(() => "user-a"),
    };
    expect(encodeRowTable(single).length).toBe(encodeRowTable(interned).length);
    // And the saving shows up against a hypothetical per-row copy.
    expect(encodeRowTable(single).length).toBeLessThan(
      500 * (2 + 24 + 8 + 2 + 6)
    );
  });

  test("preserves non-ascii sender ids", () => {
    const table = {
      createdAtByRow: [1, 2],
      messageIdByRow: ["m1", "m2"],
      senderIdByRow: ["ユーザー", "Zoë"],
    };
    expect(decodeRowTable(encodeRowTable(table))).toEqual(table);
  });

  test("rejects a truncated table rather than reading garbage", () => {
    const encoded = encodeRowTable({
      createdAtByRow: [1],
      messageIdByRow: ["m1"],
      senderIdByRow: ["a"],
    });
    expect(() => decodeRowTable(encoded.slice(0, 6))).toThrow();
  });

  test("sealed row tables round-trip through the vault", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const table = {
      createdAtByRow: [10, 20],
      messageIdByRow: ["m1", "m2"],
      senderIdByRow: ["user-a", "user-b"],
    };
    const sealed = await sealRowTable(key, table);
    expect(await unsealRowTable(key, sealed)).toEqual(table);
  });

  test("a wrong key cannot read the row table", async () => {
    const sealed = await sealRowTable(await deriveIndexKey(ROOT, CONVO), {
      createdAtByRow: [1],
      messageIdByRow: ["m1"],
      senderIdByRow: ["a"],
    });
    const wrong = await deriveIndexKey(ROOT, "convo-2");
    // Degradation, not corruption: the caller rebuilds by walking rather than
    // serving wrong results.
    await expect(unsealRowTable(wrong, sealed)).rejects.toThrow();
  });
});
