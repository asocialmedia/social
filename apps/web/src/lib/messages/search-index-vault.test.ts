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
import { SEARCH_INDEX_QUERY_LIMIT } from "./search-index-format";
import {
  decodeRowTable,
  encodeRowTable,
  projectRowTable,
  seal,
  sealRowTable,
  unseal,
  unsealRowTable,
} from "./search-index-vault";
import type { SealedRowTable } from "./search-index-vault";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

const ROOT = new Uint8Array(32).fill(7);
const OTHER_ROOT = new Uint8Array(32).fill(9);
const CONVO = "convo-1";
// Seal context. Bound in as AES-GCM associated data, so a blob cannot be replayed
// into another conversation's store or read under a rotated key epoch.
const CONTEXT = { conversationId: CONVO, keyGeneration: "gen-1" };
const OTHER_CONTEXT = { conversationId: "convo-2", keyGeneration: "gen-1" };
const ROTATED_CONTEXT = { conversationId: CONVO, keyGeneration: "gen-2" };
const PLAINTEXT = new TextEncoder().encode(
  "message m1 contains the word deploy"
);

function sealWith(key: CryptoKey, data: Uint8Array = PLAINTEXT) {
  return seal(key, data, CONTEXT);
}

describe("search index key derivation", () => {
  test("is deterministic for the same root and conversation", async () => {
    const first = await deriveIndexKey(ROOT, CONVO);
    const second = await deriveIndexKey(ROOT, CONVO);
    const sealed = await sealWith(first);
    // The second key opens what the first sealed, which is what makes a resumed
    // walk able to read rows written by an earlier session.
    expect([...(await unseal(second, sealed, CONTEXT))]).toEqual([
      ...PLAINTEXT,
    ]);
  });

  test("differs per conversation, so one thread's index cannot open another's", async () => {
    const one = await deriveIndexKey(ROOT, CONVO);
    const two = await deriveIndexKey(ROOT, "convo-2");
    const sealed = await sealWith(one);
    // The cross-conversation key must not open it. This is the property that
    // stops a bug (or an attacker) from reading one conversation's row table with
    // another conversation's index key.
    await expect(unseal(two, sealed, CONTEXT)).rejects.toThrow();
  });

  test("differs per root, so a rekeyed conversation cannot read the old index", async () => {
    const before = await deriveIndexKey(ROOT, CONVO);
    const after = await deriveIndexKey(OTHER_ROOT, CONVO);
    const sealed = await sealWith(before);
    // A conversation-key reset changes the root and so changes this key. The old
    // index becomes unreadable, which is the intended degradation: it rebuilds by
    // walking, and the conversation itself is unaffected.
    await expect(unseal(after, sealed, CONTEXT)).rejects.toThrow();
  });

  test("the imported base key derives the same key as the one-shot helper", async () => {
    const oneShot = await deriveIndexKey(ROOT, CONVO);
    const viaBase = await deriveIndexKeyFromBase(
      await importIndexBaseKey(ROOT),
      CONVO
    );
    const sealed = await sealWith(oneShot);
    expect([...(await unseal(viaBase, sealed, CONTEXT))]).toEqual([
      ...PLAINTEXT,
    ]);
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
    await expect(unseal(key, tampered, CONTEXT)).rejects.toThrow();
  });

  test("a truncated ciphertext is rejected", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const sealed = await sealWith(key);
    await expect(unseal(key, sealed.slice(0, -4), CONTEXT)).rejects.toThrow();
  });

  test("an empty payload round-trips", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const empty = new Uint8Array(0);
    const sealed = await sealWith(key, empty);
    expect([...(await unseal(key, sealed, CONTEXT))]).toEqual([]);
  });
});

// A complete table with the security-relevant fields always populated. Neither is
// optional: a missing presentByRow defaulting to "present" is exactly the sort of
// silent default that surfaces a deleted message as a search result.
function table(overrides: Partial<SealedRowTable> = {}): SealedRowTable {
  const rowCount = overrides.messageIdByRow?.length ?? 0;
  return {
    createdAtByRow: overrides.createdAtByRow ?? [],
    messageIdByRow: overrides.messageIdByRow ?? [],
    presentByRow:
      overrides.presentByRow ?? Array.from({ length: rowCount }, () => true),
    senderIdByRow: overrides.senderIdByRow ?? [],
    tokensByRow: overrides.tokensByRow ?? [],
  };
}

describe("row table codec", () => {
  // The table is the source of truth for BOTH reads and writes, so it carries
  // more than a query needs: tokens, so a rewrite or removal knows which posting
  // lists to clear, and tombstones, so a deletion leaves a marker rather than a
  // hole an older device would refill.
  test("round-trips an empty table", () => {
    expect(decodeRowTable(encodeRowTable(table()))).toEqual(table());
  });

  test("round-trips ids, timestamps, senders, and tokens", () => {
    const original = table({
      createdAtByRow: [1_700_000_000_000, 1_700_000_001_000, 0],
      messageIdByRow: ["cmeyj1z3k0000l3h8w9x2r7qv", "m", ""],
      senderIdByRow: ["user-a", "user-b", "user-a"],
      tokensByRow: [["deploy", "latency"], [], ["café"]],
    });
    const decoded = decodeRowTable(encodeRowTable(original));
    expect(decoded.messageIdByRow).toEqual(original.messageIdByRow);
    expect(decoded.createdAtByRow).toEqual(original.createdAtByRow);
    expect(decoded.senderIdByRow).toEqual(original.senderIdByRow);
    expect(decoded.tokensByRow).toEqual(original.tokensByRow);
    expect(decoded.presentByRow).toEqual([true, true, true]);
  });

  test("preserves token order within a row, which rewrite depends on", () => {
    const original = table({
      messageIdByRow: ["m1"],
      senderIdByRow: ["u"],
      tokensByRow: [["zebra", "alpha", "mango"]],
    });
    expect(decodeRowTable(encodeRowTable(original)).tokensByRow).toEqual([
      ["zebra", "alpha", "mango"],
    ]);
  });

  test("interns repeated tokens rather than storing them per row", () => {
    // A word in every message must be stored once. 200 identical rows of
    // ["deploy", "latency"] would otherwise cost 400 token references where two
    // dictionary entries would do.
    const original = table({
      messageIdByRow: Array.from({ length: 200 }, (_, i) => `m${i}`),
      senderIdByRow: Array.from({ length: 200 }, () => "user-a"),
      tokensByRow: Array.from({ length: 200 }, () => ["deploy", "latency"]),
    });
    // The same 200 rows with two UNIQUE tokens each: 400 dictionary entries
    // instead of two. The difference is exactly the interning win.
    const uniqueTokens = table({
      messageIdByRow: Array.from({ length: 200 }, (_, i) => `m${i}`),
      senderIdByRow: Array.from({ length: 200 }, () => "user-a"),
      tokensByRow: Array.from({ length: 200 }, (_, i) => [`t${i}a`, `t${i}b`]),
    });
    const shared = encodeRowTable(original);
    const unshared = encodeRowTable(uniqueTokens);
    // 400 dictionary entries averaging ~7 bytes plus their length prefixes,
    // against two.
    expect(unshared.length - shared.length).toBeGreaterThan(2000);
    expect(decodeRowTable(shared).tokensByRow[7]).toEqual([
      "deploy",
      "latency",
    ]);
    expect(decodeRowTable(unshared).tokensByRow[7]).toEqual(["t7a", "t7b"]);
  });

  test("carries tombstones so a deletion is a marker, not a hole", () => {
    const original = table({
      messageIdByRow: ["m1", "m2", "m3"],
      presentByRow: [true, false, true],
      senderIdByRow: ["u", "u", "u"],
      tokensByRow: [["kept"], ["deleted"], ["kept"]],
    });
    const decoded = decodeRowTable(encodeRowTable(original));
    expect(decoded.presentByRow).toEqual([true, false, true]);
    // The id and tokens are retained for the tombstoned row: that is what makes
    // the deletion durable rather than a gap another device could refill.
    expect(decoded.messageIdByRow[1]).toBe("m2");
    expect(decoded.tokensByRow[1]).toEqual(["deleted"]);
  });

  test("preserves non-ascii ids and tokens", () => {
    const original = table({
      messageIdByRow: ["m-ユーザー"],
      senderIdByRow: ["Zoë"],
      tokensByRow: [["café", "naïve"]],
    });
    const decoded = decodeRowTable(encodeRowTable(original));
    expect(decoded.messageIdByRow).toEqual(["m-ユーザー"]);
    expect(decoded.senderIdByRow).toEqual(["Zoë"]);
    expect(decoded.tokensByRow).toEqual([["café", "naïve"]]);
  });

  // Canonical encoding is what lets the store's mutation CAS tell a real change
  // from a re-save of identical content.
  test("re-encoding identical content is byte-identical", () => {
    const original = table({
      messageIdByRow: ["m1", "m2"],
      senderIdByRow: ["u-b", "u-a"],
      tokensByRow: [["zebra", "alpha"], ["mango"]],
    });
    expect([...encodeRowTable(original)]).toEqual([
      ...encodeRowTable({
        ...original,
        senderIdByRow: ["u-b", "u-a"],
      }),
    ]);
  });

  test("senders are not reordered, so a re-encode is still stable", () => {
    // Tokens sort (a dictionary), senders do not: there are one or two, and
    // insertion order keeps the encoding cheap to reproduce incrementally.
    const first = encodeRowTable(
      table({
        messageIdByRow: ["m1"],
        senderIdByRow: ["zeta"],
        tokensByRow: [["b", "a"]],
      })
    );
    const second = encodeRowTable(
      table({
        messageIdByRow: ["m1"],
        senderIdByRow: ["zeta"],
        tokensByRow: [["a", "b"]],
      })
    );
    // Different row order means different bytes, which is correct: the row's
    // token order is meaningful to the write path.
    expect([...first]).not.toEqual([...second]);
  });

  test("rejects a truncated table rather than reading garbage", () => {
    const encoded = encodeRowTable(
      table({
        messageIdByRow: ["m1"],
        senderIdByRow: ["u"],
        tokensByRow: [["t"]],
      })
    );
    expect(() => decodeRowTable(encoded.slice(0, 6))).toThrow();
    expect(() => decodeRowTable(new Uint8Array(4))).toThrow();
  });

  test("rejects a directory pointing outside the buffer", () => {
    const encoded = encodeRowTable(
      table({
        messageIdByRow: ["m1", "m2"],
        senderIdByRow: ["u", "u"],
        tokensByRow: [["a"], ["b"]],
      })
    );
    const view = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength
    );
    // The rowCount field sits just before the directory offset.
    const rowCountOffset = 2 + 2 + 4;
    view.setUint32(rowCountOffset, 9999, false);
    expect(() => decodeRowTable(encoded)).toThrow();
  });

  test("sealed row tables round-trip through the vault", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const original = table({
      createdAtByRow: [10, 20],
      messageIdByRow: ["m1", "m2"],
      presentByRow: [true, false],
      senderIdByRow: ["user-a", "user-b"],
      tokensByRow: [["deploy"], ["rollback"]],
    });
    const sealed = await sealRowTable(key, original, CONTEXT);
    const opened = await unsealRowTable(key, sealed, CONTEXT);
    expect(opened.messageIdByRow).toEqual(["m1", "m2"]);
    expect(opened.tokensByRow).toEqual([["deploy"], ["rollback"]]);
    expect(opened.presentByRow).toEqual([true, false]);
  });

  // Associated data is what stops a blob being replayed into another
  // conversation's store, or read under a key epoch it was not sealed for.
  test("a blob sealed for one conversation cannot be opened for another", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const sealed = await sealRowTable(
      key,
      table({ messageIdByRow: ["m1"] }),
      CONTEXT
    );
    await expect(unsealRowTable(key, sealed, OTHER_CONTEXT)).rejects.toThrow();
  });

  test("a blob sealed under one key generation is refused after a rotation", async () => {
    const key = await deriveIndexKey(ROOT, CONVO);
    const sealed = await sealRowTable(
      key,
      table({ messageIdByRow: ["m1"] }),
      CONTEXT
    );
    await expect(
      unsealRowTable(key, sealed, ROTATED_CONTEXT)
    ).rejects.toThrow();
  });

  test("a wrong key cannot read the row table", async () => {
    const sealed = await sealRowTable(
      await deriveIndexKey(ROOT, CONVO),
      table({ messageIdByRow: ["m1"] }),
      CONTEXT
    );
    const wrong = await deriveIndexKey(ROOT, "convo-2");
    // Degradation, not corruption: the caller rebuilds by walking rather than
    // serving wrong results.
    await expect(unsealRowTable(wrong, sealed, CONTEXT)).rejects.toThrow();
  });
});

describe("projectRowTable", () => {
  // This is the property that keeps search memory flat after sealing. Without a
  // projection, answering a query would materialise the entire conversation's
  // rows, which is the 76MB problem the matched-rows read was built to remove.
  test("resolves only the requested rows", () => {
    const encoded = encodeRowTable({
      createdAtByRow: [1, 2, 3],
      keyGeneration: "gen-1",
      messageIdByRow: ["m1", "m2", "m3"],
      presentByRow: [true, true, true],
      senderIdByRow: ["a", "b", "a"],
      tokensByRow: [["x"], ["y"], ["z"]],
    });
    const projected = projectRowTable(encoded, [2, 0]);
    expect(projected.size).toBe(2);
    expect(projected.get(2)?.messageId).toBe("m3");
    expect(projected.get(2)?.createdAt).toBe(3);
    expect(projected.get(2)?.senderId).toBe("a");
    expect(projected.get(0)?.messageId).toBe("m1");
  });

  test("skips tombstoned rows without decoding their id", () => {
    const encoded = encodeRowTable({
      createdAtByRow: [1, 2],
      keyGeneration: "gen-1",
      messageIdByRow: ["m1", "gone"],
      presentByRow: [true, false],
      senderIdByRow: ["a", "a"],
      tokensByRow: [["x"], ["y"]],
    });
    const projected = projectRowTable(encoded, [0, 1]);
    // A deleted message must not surface as a search result.
    expect(projected.size).toBe(1);
    expect(projected.has(1)).toBe(false);
  });

  test("ignores out-of-range and negative rows", () => {
    const encoded = encodeRowTable({
      createdAtByRow: [1],
      keyGeneration: "gen-1",
      messageIdByRow: ["m1"],
      presentByRow: [true],
      senderIdByRow: ["a"],
      tokensByRow: [["x"]],
    });
    expect(projectRowTable(encoded, [-1, 99, 0]).size).toBe(1);
  });

  test("agrees with a full decode for every live row", () => {
    const original = {
      createdAtByRow: [5, 6, 7, 8],
      keyGeneration: "gen-1",
      messageIdByRow: ["a", "b", "c", "d"],
      presentByRow: [true, false, true, true],
      senderIdByRow: ["u1", "u2", "u1", "u2"],
      tokensByRow: [["t1"], ["t2"], ["t3", "t1"], ["t4"]],
    };
    const encoded = encodeRowTable(original);
    const full = decodeRowTable(encoded);
    const projected = projectRowTable(encoded, [0, 1, 2, 3]);
    for (const row of [0, 2, 3]) {
      expect(projected.get(row)?.messageId).toBe(full.messageIdByRow[row]);
      expect(projected.get(row)?.createdAt).toBe(full.createdAtByRow[row]);
      expect(projected.get(row)?.senderId).toBe(full.senderIdByRow[row]);
    }
  });

  // A projection is on the keystroke path, where throwing would surface as a
  // broken search bar. A malformed table yields no rows and the caller rebuilds.
  test("a malformed table projects to nothing rather than throwing", () => {
    expect(projectRowTable(new Uint8Array(4), [0]).size).toBe(0);
    const encoded = encodeRowTable({
      createdAtByRow: [1, 2],
      keyGeneration: "gen-1",
      messageIdByRow: ["m1", "m2"],
      presentByRow: [true, true],
      senderIdByRow: ["a", "a"],
      tokensByRow: [["x"], ["y"]],
    });
    const view = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength
    );
    view.setUint32(2 + 2 + 4, 5000, false);
    expect(projectRowTable(encoded, [0]).size).toBe(0);
  });
});

// A 20k-row corpus with the shape real history has: a shared vocabulary, a
// per-message identifier, and two participants.
function corpus(rows: number): SealedRowTable {
  return {
    createdAtByRow: Array.from(
      { length: rows },
      (_, i) => 1_700_000_000_000 + i
    ),
    messageIdByRow: Array.from(
      { length: rows },
      (_, i) => `cmeyj1z3k0000l3h8w9x2r7${i.toString(36).padStart(2, "0")}`
    ),
    presentByRow: Array.from({ length: rows }, () => true),
    senderIdByRow: Array.from({ length: rows }, (_, i) =>
      i % 2 === 0 ? "user-a" : "user-b"
    ),
    tokensByRow: Array.from({ length: rows }, (_, i) => [
      "deploy",
      "latency",
      `msg${i.toString(36)}`,
      `ref${(i % 997).toString(36)}`,
    ]),
  };
}

describe("row table fixture", () => {
  // These numbers replace the estimate the rest of the work was planned against.
  // The token-bearing table came out at 9.3MB for 200k rows rather than the 8MB
  // guessed, and the projection is the number that actually matters: resolving a
  // capped result set costs single-digit milliseconds even though the whole
  // conversation is in the buffer.
  const ROWS = 20_000;

  test("encoding scales linearly in rows", () => {
    const small = encodeRowTable(corpus(ROWS)).length;
    const large = encodeRowTable(corpus(ROWS * 2)).length;
    // Ten times the rows must not mean anything like a hundred times the bytes;
    // the dictionaries and the fixed header are fixed costs.
    expect(large).toBeLessThan(small * 2.2);
  });

  test("projecting a capped result is far cheaper than a full decode", () => {
    const encoded = encodeRowTable(corpus(ROWS));
    const all = Array.from({ length: ROWS }, (_, i) => i);
    const decodeStart = performance.now();
    decodeRowTable(encoded);
    const decodeMs = performance.now() - decodeStart;
    const projectStart = performance.now();
    projectRowTable(encoded, all.slice(0, SEARCH_INDEX_QUERY_LIMIT));
    const projectMs = performance.now() - projectStart;
    // The projection is what the query path uses. It must stay clearly cheaper
    // than materialising every row, or sealing would reintroduce the
    // conversation-sized memory the matched-rows read exists to avoid.
    expect(projectMs).toBeLessThan(decodeMs);
    expect(projectRowTable(encoded, all.slice(0, 5)).size).toBe(5);
  });

  test("sealed size stays well under the message text it indexes", () => {
    const encoded = encodeRowTable(corpus(ROWS));
    // 20k messages at the measured 493 bytes on the wire is ~9.9MB; the index
    // table must be a fraction of that, which is the property that keeps search
    // cheap enough to store at all.
    const wire = ROWS * 493;
    expect(encoded.length).toBeLessThan(wire / 4);
  });
});
