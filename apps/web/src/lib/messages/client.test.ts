import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  appendMessageToLastPage,
  foldMessageIntoPages,
  createRootKeyStore,
  ensureConversationKeys,
  fetchConversationDetail,
  isConversationSnapshotStale,
  markMessagesDeletedInPages,
  reencryptMessageForEdit,
  removeMessagesFromPages,
  resolveMyConversationWraps,
  sendEncryptedMessage,
  toCachedMessage,
  toWrappedKeyPayloads,
  updateMessageInPages,
} from "./client";
import {
  decryptMessage,
  exportPublicKeyJwk,
  generateIdentityKeyPair,
  generateRootKey,
  encryptMessage,
  publicKeyBase64ToJwk,
  publicKeyJwkToBase64,
  wrapRootKey,
} from "./crypto";
import type { EncryptedBlob } from "./crypto";
import { applyMembershipSeq } from "./membership-seq";
import type { MessageConversationData, MessageConversationKey } from "./types";

async function makeIdentity() {
  const pair = await generateIdentityKeyPair();
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    pair,
    publicKeyBase64: publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    ),
  };
}

// Every fixture timestamp, so "joined after the epoch" is a fact about the
// fixture rather than a race against wall time.
const FIXTURE_INSTANT = new Date("2026-01-01T00:00:00.000Z");

// The profile fields a conversation payload carries. Load-bearing enough that the
// fixture is typed as the real thing: an `as never` on a fixture is exactly what
// let a required key-row column go missing here, and the send path reads that
// column.
function makeSender(user: { id: string; publicKeyBase64: string | null }) {
  return {
    avatarUrl: null,
    badge: null,
    badges: [],
    communityMemberships: [],
    displayName: user.id,
    id: user.id,
    messageIdentity: user.publicKeyBase64
      ? { publicKey: user.publicKeyBase64 }
      : null,
    username: user.id,
  };
}

// A key ROW, exactly as the server stores it. Every column is filled in, because
// a fixture that omits one is not a conversation any server could have sent — and
// `version` in particular is load-bearing: the send path takes the newest epoch
// from these rows, so a fixture without it answers NaN where the real payload
// answers a number.
function makeKeyRow(row: {
  conversationId: string;
  createdAt?: Date;
  encryptedKey: string;
  iv: string;
  ownerUserId: string;
  version?: number;
  wrapperPublicKey?: string | null;
  wrapperUserId?: string | null;
}): MessageConversationKey {
  return {
    conversationId: row.conversationId,
    createdAt: row.createdAt ?? FIXTURE_INSTANT,
    encryptedKey: row.encryptedKey,
    id: `${row.conversationId}:${row.ownerUserId}:${row.version ?? 1}`,
    iv: row.iv,
    ownerUserId: row.ownerUserId,
    ratchetCounter: 0,
    version: row.version ?? 1,
    wrapperPublicKey: row.wrapperPublicKey ?? null,
    wrapperUserId: row.wrapperUserId ?? null,
  };
}

function makeConversation(
  id: string,
  me: { id: string; publicKeyBase64: string },
  them: { id: string; publicKeyBase64: string }
): MessageConversationData {
  return {
    createdAt: FIXTURE_INSTANT,
    id,
    keys: [],
    members: [me, them].map((person) => ({
      conversationId: id,
      createdAt: FIXTURE_INSTANT,
      lastReadAt: null,
      user: makeSender(person),
      userId: person.id,
    })),
    pairKey: [me.id, them.id].toSorted().join(":"),
    type: "DM",
    updatedAt: FIXTURE_INSTANT,
  };
}

// Fixed clock for the den fixtures. Wrap rows and member rows both carry the time
// they were written, and the send path reads the two against each other: a member
// who predates an epoch may be healed into it, one who arrived at or after it may
// not.
const DEN_EPOCH_ONE_AT = new Date("2026-01-01T00:00:00.000Z");
const DEN_EPOCH_TWO_AT = new Date("2026-01-02T00:00:00.000Z");
const DEN_JOINED_LATE = new Date("2026-02-01T00:00:00.000Z");

// A den conversation fixture: N members, each with their own identity, and root-
// key epochs fanned out to all of them. `keys` uses the server's ROW shape
// (ciphertext and iv as siblings) because that is what a conversation payload
// carries, so the adapter is exercised on the way through.
function makeDenConversation(
  id: string,
  members: readonly {
    createdAt?: Date;
    id: string;
    // A member who left or was removed. They keep the roster row so the reader's
    // name resolves and their history stays, which is exactly why the key
    // machinery has to be told to stop treating them as a member.
    leftAt?: Date | null;
    publicKeyBase64?: string;
  }[]
): MessageConversationData {
  return {
    createdAt: FIXTURE_INSTANT,
    id,
    keys: [],
    members: members.map((member) => ({
      conversationId: id,
      createdAt: member.createdAt ?? DEN_EPOCH_ONE_AT,
      lastReadAt: null,
      leftAt: member.leftAt ?? null,
      // The one-stint window the detail route would attach for a member who
      // never left: inside since their join, unclosed. The heal gate fails
      // closed without it, which would rotate where the fixture means a heal.
      membershipWindows: [
        {
          after: (member.createdAt ?? DEN_EPOCH_ONE_AT).toISOString(),
          before: null,
        },
      ],
      user: makeSender({
        id: member.id,
        publicKeyBase64: member.publicKeyBase64 ?? null,
      }),
      userId: member.id,
    })),
    pairKey: null,
    type: "DEN",
    updatedAt: FIXTURE_INSTANT,
  };
}

// Turns the captured POST bodies into the rows a server would have written, so a
// test can feed them back in as the next snapshot. `wrapperUserId` is what a
// den reader resolves its pairing through, so it has to survive the round trip.
function storedKeys(
  posts: readonly {
    encryptedKey: EncryptedBlob;
    ownerUserId: string;
    version?: number;
    wrapperPublicKey?: string | null;
    wrapperUserId?: string | null;
  }[],
  writtenAt: Date
) {
  return posts.map((key) => ({
    createdAt: writtenAt,
    encryptedKey: key.encryptedKey.ciphertext,
    iv: key.encryptedKey.iv,
    ownerUserId: key.ownerUserId,
    version: key.version ?? 1,
    wrapperPublicKey: key.wrapperPublicKey ?? null,
    wrapperUserId: key.wrapperUserId ?? null,
  }));
}

// Every wrapped key posted by the code under test, exactly as it went over the
// wire, so a test can assert on the version, the wrapper, and the beneficiary of
// the same row.
// Wraps `rootKey` for every member of `den` at `version`, the way the client does,
// so a test can build a realistic epoch without going through
// ensureConversationKeys (which is the thing under test). The pairings are
// independent, so they are derived together rather than one at a time.
async function fanOutEpoch(
  den: MessageConversationData,
  rootKey: Uint8Array,
  rotator: { id: string; pair: CryptoKeyPair; publicKeyBase64: string },
  version: number,
  writtenAt: Date = DEN_EPOCH_ONE_AT
) {
  const withIdentity = den.members.filter(
    (member) => member.user.messageIdentity !== null
  );
  const blobs = await Promise.all(
    withIdentity.map(
      async (member) =>
        await wrapRootKey(
          rotator.pair.privateKey,
          await importIdentityKey(member.user.messageIdentity?.publicKey ?? ""),
          den.id,
          rootKey
        )
    )
  );
  for (const [index, member] of withIdentity.entries()) {
    const encryptedKey = blobs[index];
    if (!encryptedKey) {
      continue;
    }
    den.keys.push(
      makeKeyRow({
        conversationId: den.id,
        createdAt: writtenAt,
        encryptedKey: encryptedKey.ciphertext,
        iv: encryptedKey.iv,
        ownerUserId: member.userId,
        version,
        wrapperPublicKey: rotator.publicKeyBase64,
        wrapperUserId: rotator.id,
      })
    );
  }
}

// A P-256 public key from the base64 form the wire carries.
async function importIdentityKey(publicKeyBase64: string) {
  return await globalThis.crypto.subtle.importKey(
    "jwk",
    await publicKeyBase64ToJwk(publicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

const postedKeys: {
  encryptedKey: EncryptedBlob;
  ownerUserId: string;
  version?: number;
  wrapperPublicKey?: string | null;
  wrapperUserId?: string | null;
}[] = [];

describe("createRootKeyStore", () => {
  test("unwraps and memoizes the root key per conversation", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const rootKey = generateRootKey();

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const wrappedForAlice = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-1",
      rootKey
    );

    const store = createRootKeyStore(alice.pair.privateKey);
    const unwrapped1 = await store.getRootKeys(
      "convo-1",
      [{ encryptedKey: wrappedForAlice, version: 1 }],
      bob.publicKeyBase64
    );
    const unwrapped2 = await store.getRootKeys(
      "convo-1",
      [{ encryptedKey: wrappedForAlice, version: 1 }],
      bob.publicKeyBase64
    );
    expect(Buffer.from(unwrapped1[0]).equals(Buffer.from(rootKey))).toBe(true);
    // Memoized: the second call returns the exact same array reference as the
    // first (the cached promise resolves to one instance).
    expect(unwrapped2).toBe(unwrapped1);
    expect(Buffer.from(unwrapped2[0]).equals(Buffer.from(rootKey))).toBe(true);
  });

  // A peer reset or a re-provisioned identity publishes new wraps under the SAME
  // conversation id. Keying the cache on the conversation alone returned the
  // superseded roots, so decryption silently continued with keys the server had
  // already rotated away. The thread detects the change but only cleared the
  // decryptor's cache, not this one.
  test("re-derives when the wraps change under the same conversation", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const firstRoot = generateRootKey();
    const secondRoot = generateRootKey();

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const store = createRootKeyStore(alice.pair.privateKey);

    const before = await store.getRootKeys(
      "convo-1",
      [
        {
          encryptedKey: await wrapRootKey(
            alice.pair.privateKey,
            bobKey,
            "convo-1",
            firstRoot
          ),
          version: 1,
        },
      ],
      bob.publicKeyBase64
    );
    expect(Buffer.from(before[0]).equals(Buffer.from(firstRoot))).toBe(true);

    // The same conversation, newly wrapped: a keys.rotated event.
    const after = await store.getRootKeys(
      "convo-1",
      [
        {
          encryptedKey: await wrapRootKey(
            alice.pair.privateKey,
            bobKey,
            "convo-1",
            secondRoot
          ),
          version: 2,
        },
      ],
      bob.publicKeyBase64
    );
    expect(Buffer.from(after[0]).equals(Buffer.from(secondRoot))).toBe(true);
    // Explicitly not the stale answer.
    expect(Buffer.from(after[0]).equals(Buffer.from(firstRoot))).toBe(false);
  });

  test("re-derives when the peer key changes under the same conversation", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const rootKey = generateRootKey();

    const store = createRootKeyStore(alice.pair.privateKey);
    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const wrappedForBob = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-1",
      rootKey
    );
    const carolPub = await publicKeyBase64ToJwk(carol.publicKeyBase64);
    const carolKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      carolPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const wrappedForCarol = await wrapRootKey(
      alice.pair.privateKey,
      carolKey,
      "convo-1",
      rootKey
    );

    await store.getRootKeys(
      "convo-1",
      [{ encryptedKey: wrappedForBob, version: 1 }],
      bob.publicKeyBase64
    );
    // A different peer key produces different ECDH results from the same wrap
    // list, so the cached answer for Bob must not be reused for Carol.
    const forCarol = await store.getRootKeys(
      "convo-1",
      [{ encryptedKey: wrappedForCarol, version: 1 }],
      carol.publicKeyBase64
    );
    expect(Buffer.from(forCarol[0]).equals(Buffer.from(rootKey))).toBe(true);
  });

  test("offers one root per epoch, newest first, dropping stale wraps", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    // A prior identity of Alice's, whose wraps her current key cannot unwrap.
    const oldAlice = await makeIdentity();
    const oldRoot = generateRootKey();
    const newRoot = generateRootKey();

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    // v1 was wrapped for oldAlice (stale after a reset); v2 for current Alice.
    const v1 = await wrapRootKey(
      oldAlice.pair.privateKey,
      bobKey,
      "convo-1",
      oldRoot
    );
    const v2 = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-1",
      newRoot
    );

    const store = createRootKeyStore(alice.pair.privateKey);
    const roots = await store.getRootKeys(
      // Deliberately out of order: the store must sort newest-first itself.
      "convo-1",
      [
        { encryptedKey: v1, version: 1 },
        { encryptedKey: v2, version: 2 },
      ],
      bob.publicKeyBase64
    );
    // v1 is dropped (unwrappable only by the superseded identity), v2 survives.
    expect(roots).toHaveLength(1);
    expect(Buffer.from(roots[0]).equals(Buffer.from(newRoot))).toBe(true);
  });
});

describe("ensureConversationKeys", () => {
  // What the server says the next detail read returns, so a test can move the
  // conversation row forward without a database. The staleness guard reads the
  // conversation's `updatedAt`, so this is what makes a cached snapshot overtakeable.
  let detailResponse: { conversation: unknown } | null = null;
  const originalFetch = globalThis.fetch;
  const fetchMock = mock((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/keys")) {
      const body = JSON.parse(String(init?.body)) as {
        keys: typeof postedKeys;
      };
      postedKeys.push(...body.keys);
      return Response.json({ ok: true }, { status: 200 });
    }
    if (url.includes("/api/messages/conversations/") && detailResponse) {
      return Response.json(detailResponse, { status: 200 });
    }
    return Response.json({}, { status: 404 });
  });

  beforeEach(() => {
    postedKeys.length = 0;
    detailResponse = null;
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("generates keys for both members when none exist", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const convo = makeConversation("convo-new", alice, bob);

    const rootKey = await ensureConversationKeys(
      convo,
      alice.pair.privateKey,
      alice.id
    );

    expect(rootKey).not.toBeNull();
    expect(rootKey?.byteLength).toBe(32);
    expect(postedKeys).toHaveLength(2);
    const owners = postedKeys.map((key) => key.ownerUserId).toSorted();
    expect(owners).toEqual([alice.id, bob.id].toSorted());
  });

  test("returns the unwrapped root without posting when keys exist", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const convo = makeConversation("convo-existing", alice, bob);
    const rootKey = generateRootKey();

    const alicePub = await publicKeyBase64ToJwk(alice.publicKeyBase64);
    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const [aliceKey, bobKey] = await Promise.all([
      globalThis.crypto.subtle.importKey(
        "jwk",
        alicePub,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
      ),
      globalThis.crypto.subtle.importKey(
        "jwk",
        bobPub,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
      ),
    ]);
    const wrappedForAlice = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-existing",
      rootKey
    );
    const wrappedForBob = await wrapRootKey(
      bob.pair.privateKey,
      aliceKey,
      "convo-existing",
      rootKey
    );
    convo.keys = [
      makeKeyRow({
        conversationId: convo.id,
        encryptedKey: wrappedForAlice.ciphertext,
        iv: wrappedForAlice.iv,
        ownerUserId: alice.id,
      }),
      makeKeyRow({
        conversationId: convo.id,
        encryptedKey: wrappedForBob.ciphertext,
        iv: wrappedForBob.iv,
        ownerUserId: bob.id,
      }),
    ];

    const unwrapped = await ensureConversationKeys(
      convo,
      alice.pair.privateKey,
      alice.id
    );
    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(true);
    expect(postedKeys).toHaveLength(0);
  });

  test("heals a conversation missing only the peer's key", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const convo = makeConversation("convo-heal", alice, bob);
    const rootKey = generateRootKey();

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const wrappedForAlice = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-heal",
      rootKey
    );
    convo.keys = [
      makeKeyRow({
        conversationId: convo.id,
        encryptedKey: wrappedForAlice.ciphertext,
        iv: wrappedForAlice.iv,
        ownerUserId: alice.id,
      }),
    ];

    const unwrapped = await ensureConversationKeys(
      convo,
      alice.pair.privateKey,
      alice.id
    );
    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(true);
    // Only the peer's missing key is posted.
    expect(postedKeys).toHaveLength(1);
    expect(postedKeys[0].ownerUserId).toBe(bob.id);
  });

  test("rotates to a new epoch when the identity changed and no wrap unwraps", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    // The identity that actually made the stored wrap; Alice has since reset.
    const oldAlice = await makeIdentity();
    const convo = makeConversation("convo-rotate", alice, bob);

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const staleA = await wrapRootKey(
      oldAlice.pair.privateKey,
      bobKey,
      "convo-rotate",
      generateRootKey()
    );
    const staleB = await wrapRootKey(
      oldAlice.pair.privateKey,
      bobKey,
      "convo-rotate",
      generateRootKey()
    );
    convo.keys = [
      makeKeyRow({
        conversationId: convo.id,
        encryptedKey: staleA.ciphertext,
        iv: staleA.iv,
        ownerUserId: alice.id,
      }),
      makeKeyRow({
        conversationId: convo.id,
        encryptedKey: staleB.ciphertext,
        iv: staleB.iv,
        ownerUserId: bob.id,
      }),
    ];

    const rootKey = await ensureConversationKeys(
      convo,
      alice.pair.privateKey,
      alice.id
    );

    // A fresh root is returned and wrapped for both members at the next epoch.
    expect(rootKey).not.toBeNull();
    expect(postedKeys).toHaveLength(2);
    const versions = postedKeys.map(
      (key) => (key as { version?: number }).version
    );
    expect(versions).toEqual([2, 2]);
    const owners = postedKeys.map((key) => key.ownerUserId).toSorted();
    expect(owners).toEqual([alice.id, bob.id].toSorted());
  });

  test("heals a peer wrap missing for the current epoch only", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const convo = makeConversation("convo-epoch-heal", alice, bob);
    const rootKey = generateRootKey();

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const wrappedForAlice = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-epoch-heal",
      rootKey
    );
    // Alice already holds epoch 2; the peer's epoch-2 wrap never landed. The
    // stale epoch-1 peer wrap must not satisfy the check.
    convo.keys = [
      makeKeyRow({
        conversationId: convo.id,
        encryptedKey: wrappedForAlice.ciphertext,
        iv: wrappedForAlice.iv,
        ownerUserId: alice.id,
        version: 2,
      }),
    ];

    const unwrapped = await ensureConversationKeys(
      convo,
      alice.pair.privateKey,
      alice.id
    );
    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(true);
    // Exactly the peer's missing epoch-2 wrap is posted.
    expect(postedKeys).toHaveLength(1);
    expect(postedKeys[0].ownerUserId).toBe(bob.id);
    expect((postedKeys[0] as { version?: number }).version).toBe(2);
  });

  test("refreshes before rotating so a stale peer key is never used", async () => {
    // The stale-snapshot bug: Alice holds a snapshot whose peer public key is
    // Bob's OLD key, so nothing unwraps and she would rotate a fresh epoch
    // wrapped for a key Bob can no longer use. With a refresh available, the
    // freshest snapshot (Bob's current key + an unwrappable wrap) is used
    // instead and no rotation happens.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const staleBob = await makeIdentity();
    const rootKey = generateRootKey();

    // The stored wrap was made for Alice's CURRENT key against Bob's CURRENT
    // key; only the conversation snapshot's peer public key is stale.
    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const wrappedForAlice = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-refresh",
      rootKey
    );
    const staleConvo = makeConversation("convo-refresh", alice, staleBob);
    staleConvo.keys = [
      makeKeyRow({
        conversationId: staleConvo.id,
        encryptedKey: wrappedForAlice.ciphertext,
        iv: wrappedForAlice.iv,
        ownerUserId: alice.id,
      }),
      makeKeyRow({
        conversationId: staleConvo.id,
        encryptedKey: wrappedForAlice.ciphertext,
        iv: wrappedForAlice.iv,
        ownerUserId: bob.id,
      }),
    ];

    const freshConvo = makeConversation("convo-refresh", alice, bob);
    freshConvo.keys = staleConvo.keys;

    const unwrapped = await ensureConversationKeys(
      staleConvo,
      alice.pair.privateKey,
      alice.id,
      { refreshConversation: () => Promise.resolve(freshConvo) }
    );
    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(true);
    // No new epoch was minted: the refresh healed it.
    expect(postedKeys).toHaveLength(0);
  });

  test("rotates against the refreshed snapshot when still nothing unwraps", async () => {
    // When the identity really did change, the refresh still returns a newer
    // peer key and the rotation must use THAT key, not the stale one.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const staleBob = await makeIdentity();
    const oldAlice = await makeIdentity();

    // A wrap only oldAlice could unwrap, so current Alice must rotate.
    const staleBobPub = await publicKeyBase64ToJwk(staleBob.publicKeyBase64);
    const staleBobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      staleBobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const staleWrap = await wrapRootKey(
      oldAlice.pair.privateKey,
      staleBobKey,
      "convo-rotate-refresh",
      generateRootKey()
    );
    const staleConvo = makeConversation(
      "convo-rotate-refresh",
      alice,
      staleBob
    );
    staleConvo.keys = [
      makeKeyRow({
        conversationId: staleConvo.id,
        encryptedKey: staleWrap.ciphertext,
        iv: staleWrap.iv,
        ownerUserId: alice.id,
      }),
    ];
    const freshConvo = makeConversation("convo-rotate-refresh", alice, bob);
    freshConvo.keys = staleConvo.keys;

    const rootKey = await ensureConversationKeys(
      staleConvo,
      alice.pair.privateKey,
      alice.id,
      { refreshConversation: () => Promise.resolve(freshConvo) }
    );
    expect(rootKey).not.toBeNull();
    expect(postedKeys).toHaveLength(2);
    // Both wraps are epoch 2 for both members (a fresh rotation).
    expect(
      postedKeys.map((key) => (key as { version?: number }).version)
    ).toEqual([2, 2]);
  });

  // ---- dens ---------------------------------------------------------------
  //
  // A den is the same protocol with N members: ONE fresh root key per epoch,
  // wrapped separately once per member, all posted at the same version. These
  // cover the fan-out, the heal that costs a newly added member, and the three
  // conditions that must mint a new epoch instead.

  test("fans one fresh epoch out to every member, rotator included", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const dave = await makeIdentity();
    const den = makeDenConversation("den-fanout", [alice, bob, carol, dave]);

    const rootKey = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id
    );

    expect(rootKey).not.toBeNull();
    // One wrap per member, INCLUDING the rotator: a den whose owner cannot read
    // its own epoch is not a working den.
    expect(postedKeys).toHaveLength(4);
    expect(postedKeys.map((key) => key.ownerUserId).toSorted()).toEqual(
      [alice.id, bob.id, carol.id, dave.id].toSorted()
    );
    // One epoch: every wrap denotes the same root, so they all carry one version.
    expect(postedKeys.map((key) => key.version)).toEqual([1, 1, 1, 1]);
    // One wrapper: the member who performed the fan-out, named on every row, with
    // the public key a reader needs to reconstruct the pairing.
    for (const key of postedKeys) {
      expect(key.wrapperUserId).toBe(alice.id);
      expect(key.wrapperPublicKey).toBe(alice.publicKeyBase64);
    }
    // Independent wraps, not one blob repeated: distinct ciphertexts per member.
    expect(
      new Set(postedKeys.map((key) => key.encryptedKey.ciphertext)).size
    ).toBe(4);

    // And every member can read the epoch back to the same root, which is the
    // only reason one set of message keys serves the whole den.
    den.keys = storedKeys(postedKeys, DEN_EPOCH_ONE_AT);
    const reads = await Promise.all(
      [alice, bob, carol, dave].map(async (member) => {
        const store = createRootKeyStore(member.pair.privateKey);
        return await store.getRootKeys(
          den.id,
          resolveMyConversationWraps(
            toWrappedKeyPayloads(den.keys),
            den,
            member.id
          ),
          ""
        );
      })
    );
    for (const roots of reads) {
      expect(
        Buffer.from(roots[0] ?? new Uint8Array()).equals(
          Buffer.from(rootKey ?? new Uint8Array())
        )
      ).toBe(true);
    }
  });

  test("returns the current epoch and writes nothing when the roster is covered", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const den = makeDenConversation("den-complete", [alice, bob, carol]);
    const rootKey = generateRootKey();
    await fanOutEpoch(den, rootKey, alice, 1);

    const unwrapped = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id
    );

    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(true);
    // The send path must not fan out 3 ECDH pairings on every send: the epoch is
    // already complete, so this is one unwrap and no writes at all.
    expect(postedKeys).toHaveLength(0);
  });

  test("heals only the interrupted wrap, at the epoch already in use", async () => {
    // The heal case, and the only one. Two epochs were minted while Carol was in
    // the room and the second fan-out did not finish: she holds epoch 1 and no
    // epoch 2. That is the shape an interrupted fan-out leaves behind, and it is
    // distinguishable from an arrival only by that older wrap, because a member
    // holding no wrap at all was never in the room when any root was handed out.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const den = makeDenConversation("den-heal", [alice, bob, carol]);
    const firstEpoch = generateRootKey();
    await fanOutEpoch(den, firstEpoch, alice, 1);
    const secondEpoch = generateRootKey();
    await fanOutEpoch(den, secondEpoch, alice, 2, DEN_EPOCH_TWO_AT);
    den.keys = den.keys.filter(
      (key) => !(key.ownerUserId === carol.id && key.version === 2)
    );

    const unwrapped = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id
    );

    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(
        Buffer.from(secondEpoch)
      )
    ).toBe(true);
    // Exactly the one missing wrap, at the epoch already in use. Minting a new
    // epoch here would be wasted work, and rotating on every membership blip would
    // be a denial of service on the den.
    expect(postedKeys).toHaveLength(1);
    expect(postedKeys[0]?.ownerUserId).toBe(carol.id);
    expect(postedKeys[0]?.version).toBe(2);
    expect(postedKeys[0]?.wrapperUserId).toBe(alice.id);
  });

  test("rotates rather than healing a member who joined after the epoch", async () => {
    // Forward secrecy, stated as a key decision. The current epoch's root encrypts
    // every message ever sent in it, so a newcomer healed into it would read the
    // den's whole history. A new epoch is the only way to leave them out of the
    // past.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const den = makeDenConversation("den-late-join", [alice, bob]);
    const rootKey = generateRootKey();
    await fanOutEpoch(den, rootKey, alice, 1);
    // Carol joins after epoch 1 was written. She holds no wrap for it.
    den.members.push({
      createdAt: DEN_JOINED_LATE,
      user: {
        id: carol.id,
        messageIdentity: { publicKey: carol.publicKeyBase64 },
      },
      userId: carol.id,
    });

    const unwrapped = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id
    );

    expect(unwrapped).not.toBeNull();
    // A brand new epoch for the whole roster, rather than a wrap into the old one.
    expect(postedKeys.map((key) => key.version)).toEqual([2, 2, 2]);
    expect(postedKeys.map((key) => key.ownerUserId).toSorted()).toEqual(
      [alice.id, bob.id, carol.id].toSorted()
    );
    // Epoch 1 is left exactly as it was: intact for the two who could read it, and
    // unreachable for the one who could not.
    expect(den.keys.filter((key) => key.version === 1)).toHaveLength(2);
    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(false);
  });

  test("rotates when this member holds no wrap for the newest epoch", async () => {
    // Carol arrived through an invite after Alice minted epoch 1 for everyone
    // else. Carol holds nothing, so she cannot read what she is about to send
    // under, and the only correct move is a new epoch covering the new roster.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const den = makeDenConversation("den-invite", [alice, bob, carol]);
    const firstEpoch = generateRootKey();
    await fanOutEpoch(den, firstEpoch, alice, 1);
    den.keys = den.keys.filter((key) => key.ownerUserId !== carol.id);

    const rootKey = await ensureConversationKeys(
      den,
      carol.pair.privateKey,
      carol.id
    );

    expect(rootKey).not.toBeNull();
    // A brand new epoch (2), fanned out to the whole roster, with Carol as the
    // wrapper because Carol is the one minting it.
    expect(postedKeys.map((key) => key.version)).toEqual([2, 2, 2]);
    expect(postedKeys.map((key) => key.ownerUserId).toSorted()).toEqual(
      [alice.id, bob.id, carol.id].toSorted()
    );
    for (const key of postedKeys) {
      expect(key.wrapperUserId).toBe(carol.id);
    }
    // Epoch 1 is untouched, so the pre-join history is still readable by the
    // members who were there.
    expect(den.keys.filter((key) => key.version === 1)).toHaveLength(2);
  });

  test("rotates when the newest epoch still has a wrap for a member who left", async () => {
    // The forward-secrecy trigger. Bob left the den but keeps the wrap he already
    // had, so anything written into that epoch stays readable to him. The only
    // way to stop that is a new epoch the remaining members write into instead.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const den = makeDenConversation("den-removed", [alice, bob, carol]);
    const sharedEpoch = generateRootKey();
    await fanOutEpoch(den, sharedEpoch, alice, 1);
    den.members = den.members.filter((member) => member.userId !== bob.id);

    const rootKey = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id
    );

    expect(rootKey).not.toBeNull();
    // A new epoch for the remaining roster only.
    expect(postedKeys.map((key) => key.version)).toEqual([2, 2]);
    expect(postedKeys.map((key) => key.ownerUserId).toSorted()).toEqual(
      [alice.id, carol.id].toSorted()
    );
    // Bob's old wrap is still on file. It is never deleted, because it is his
    // history from before he left.
    expect(
      den.keys.some((key) => key.ownerUserId === bob.id && key.version === 1)
    ).toBe(true);
  });

  test("skips a member with no identity, reports them, and still mints a usable epoch", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const silent = await makeIdentity();
    const den = makeDenConversation("den-keyless", [
      alice,
      bob,
      // A member who has not enabled messages: on the roster, no identity row.
      { id: silent.id },
    ]);
    const reported: string[][] = [];

    const rootKey = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id,
      { onUnwrappableMembers: (ids) => reported.push(ids) }
    );

    expect(rootKey).not.toBeNull();
    // The epoch exists and is complete for everyone who can read it. Refusing to
    // rotate would have cost Alice and Bob their next message over a member who
    // never opted into messages.
    expect(postedKeys.map((key) => key.ownerUserId).toSorted()).toEqual(
      [alice.id, bob.id].toSorted()
    );
    // And the skip is reported rather than silent, so the UI can say so.
    expect(reported).toEqual([[silent.id]]);
  });

  test("a heal whose only gap is an unwrappable member does not block the send", async () => {
    // The awkward middle: the current epoch is readable, the one member missing a
    // wrap for it cannot be wrapped for at all, and there is nobody else to write.
    // The epoch is still good enough to send under for everybody who can read it,
    // so the send proceeds and the skip is reported rather than the message being
    // refused over a member who never enabled messages.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const quiet = await makeIdentity();
    const den = makeDenConversation("den-heal-keyless", [alice, bob, quiet]);
    // Quiet was in the room for epoch 1 and holds its wrap, which is what makes
    // them a heal candidate rather than an arrival. They then turned messages off,
    // so the roster no longer has a key to wrap for and the second fan-out leaves
    // them out.
    await fanOutEpoch(den, generateRootKey(), alice, 1);
    den.members = den.members.map((member) =>
      member.userId === quiet.id
        ? {
            ...member,
            user: makeSender({ id: quiet.id, publicKeyBase64: null }),
          }
        : member
    );
    const secondEpoch = generateRootKey();
    await fanOutEpoch(den, secondEpoch, alice, 2, DEN_EPOCH_TWO_AT);
    const reported: string[][] = [];

    const unwrapped = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id,
      { onUnwrappableMembers: (ids) => reported.push(ids) }
    );

    expect(
      Buffer.from(unwrapped ?? new Uint8Array()).equals(
        Buffer.from(secondEpoch)
      )
    ).toBe(true);
    expect(reported).toEqual([[quiet.id]]);
    // Nothing was posted, because there was nothing valid to post.
    expect(postedKeys).toHaveLength(0);
  });

  test("a member holding no wrap at all is an arrival, not an interrupted fan-out", async () => {
    // The signal the heal path is built around. A member with no wrap for any
    // epoch was never in the room when any root was fanned out, so handing them
    // the current root would hand them every message written under it. There is
    // no shape of interrupted fan-out that produces this, which is exactly why the
    // wrap set is trusted here and a millisecond-truncated clock is not.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const den = makeDenConversation("den-arrival", [alice, bob]);
    await fanOutEpoch(den, generateRootKey(), alice, 1);
    // Carol is on the roster with a membership row stamped a full day BEFORE the
    // epoch — the most favourable reading a clock comparison could possibly get.
    // They hold no wrap for any epoch, which is the one thing that cannot be a
    // clock artefact: an interrupted fan-out always leaves the older wrap behind.
    den.members.push({
      conversationId: den.id,
      createdAt: new Date("2025-12-31T00:00:00.000Z"),
      lastReadAt: null,
      user: makeSender({
        id: carol.id,
        publicKeyBase64: carol.publicKeyBase64,
      }),
      userId: carol.id,
    });

    const rootKey = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id
    );

    expect(rootKey).not.toBeNull();
    expect(postedKeys.map((key) => key.version)).toEqual([2, 2, 2]);
  });

  test("no fan-out and no write on the happy path, across every member", async () => {
    // The performance guard, stated as a test: 100 members, one complete epoch,
    // and every one of their send paths must do a single unwrap and nothing else.
    const members = await Promise.all([
      makeIdentity(),
      makeIdentity(),
      makeIdentity(),
      makeIdentity(),
      makeIdentity(),
    ]);
    const [alice] = members;
    if (!alice) {
      throw new Error("expected a rotator");
    }
    const den = makeDenConversation("den-happy", members);
    const rootKey = generateRootKey();
    await fanOutEpoch(den, rootKey, alice, 1);

    const unwrapped = await Promise.all(
      members.map(
        async (member) =>
          await ensureConversationKeys(den, member.pair.privateKey, member.id)
      )
    );
    for (const rootKeyForMember of unwrapped) {
      expect(
        Buffer.from(rootKeyForMember ?? new Uint8Array()).equals(
          Buffer.from(rootKey)
        )
      ).toBe(true);
    }
    expect(postedKeys).toHaveLength(0);
  });

  test("a departed member's old wrap forces a rotation, and is not re-wrapped", async () => {
    // Leaving stamps the membership row instead of deleting it, so the roster
    // still names Bob and Bob still holds epoch 1. That is the history and it is
    // deliberate, and it also means epoch 1 is contaminated: anything written into
    // it, Bob can read. So the next send must rotate, and the new epoch must be
    // wrapped for the people still in the room and nobody else.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const den = makeDenConversation("den-departed", [alice, bob]);
    await fanOutEpoch(den, generateRootKey(), alice, 1);
    const bobRow = den.members.find((member) => member.userId === bob.id);
    if (!bobRow) {
      throw new Error("expected Bob's row");
    }
    bobRow.leftAt = new Date("2026-01-03T00:00:00.000Z");

    const rootKey = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id
    );

    expect(rootKey).not.toBeNull();
    // Exactly one wrap, the new epoch, for Alice. Bob is not in a den he left.
    expect(postedKeys).toHaveLength(1);
    expect(postedKeys[0]?.ownerUserId).toBe(alice.id);
    expect(postedKeys[0]?.version).toBe(2);
    expect(postedKeys.some((key) => key.ownerUserId === bob.id)).toBe(false);
  });

  test("a departed member missing the current epoch is not healed into it", async () => {
    // The heal path exists to hand the current root to a member who was in the
    // room when it was minted but whose wrap was lost. A departed member can look
    // identical to that - no wrap for the newest epoch, a tenure older than it -
    // and healing them would hand them everything said after they left.
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const den = makeDenConversation("den-no-heal-departed", [alice, bob]);
    await fanOutEpoch(den, generateRootKey(), alice, 1);
    // Bob leaves before epoch 2, so epoch 2 is fanned out to Alice alone.
    const bobRow = den.members.pop();
    if (!bobRow) {
      throw new Error("expected Bob's row");
    }
    const epochTwo = generateRootKey();
    await fanOutEpoch(den, epochTwo, alice, 2, DEN_EPOCH_TWO_AT);
    bobRow.leftAt = new Date("2026-01-15T00:00:00.000Z");
    den.members.push(bobRow);

    const rootKey = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id
    );

    expect(
      Buffer.from(rootKey ?? new Uint8Array()).equals(Buffer.from(epochTwo))
    ).toBe(true);
    expect(postedKeys).toHaveLength(0);
  });
});

describe("resolveMyConversationWraps", () => {
  const alice = { id: "alice", publicKeyBase64: "alice-pub" };
  const bob = { id: "bob", publicKeyBase64: "bob-pub" };
  const den = makeDenConversation("den-resolve", [alice, bob]);

  test("pairs a DM row with nothing, leaving the peer as the fallback", () => {
    // The DM contract: no wrapperUserId means the peer, which the caller supplies.
    const convo = makeConversation("dm-resolve", alice, bob);
    convo.keys = [
      makeKeyRow({
        conversationId: convo.id,
        encryptedKey: "ct",
        iv: "iv",
        ownerUserId: alice.id,
        version: 2,
      }),
      makeKeyRow({
        conversationId: convo.id,
        encryptedKey: "ct",
        iv: "iv",
        ownerUserId: alice.id,
      }),
    ];
    const resolved = resolveMyConversationWraps(
      toWrappedKeyPayloads(convo.keys),
      convo,
      alice.id
    );
    expect(resolved.map((wrap) => wrap.version)).toEqual([2, 1]);
    expect(resolved.every((wrap) => wrap.wrapperPublicKeyBase64 === null)).toBe(
      true
    );
  });

  test("pairs each den row with the key its blob was actually made against", () => {
    const resolved = resolveMyConversationWraps(
      [
        {
          encryptedKey: { ciphertext: "ct", iv: "iv" },
          ownerUserId: alice.id,
          version: 2,
          // A different key from Bob's live identity: Bob reset, and the new row
          // is not the one this blob was paired against.
          wrapperPublicKey: "snapshot-bob-pub",
          wrapperUserId: bob.id,
        },
      ],
      den,
      alice.id
    );
    // The snapshot, not Bob's live key. The blob is an ECDH pairing with the
    // snapshot's key, so pairing it with anything else cannot unwrap — and because
    // the pairing is shared by every member's copy of that epoch, resolving wrong
    // strands the whole den's copy of it, Bob's own included.
    expect(resolved[0]?.wrapperPublicKeyBase64).toBe("snapshot-bob-pub");
  });

  test("falls back to the wrapper's live key when the row names no snapshot", () => {
    // The legacy shape: a den row written before the snapshot column existed, by
    // a wrapper still on the roster. There is nothing recorded, so the live
    // identity is the only pairing that exists.
    const resolved = resolveMyConversationWraps(
      [
        {
          encryptedKey: { ciphertext: "ct", iv: "iv" },
          ownerUserId: alice.id,
          version: 1,
          wrapperPublicKey: null,
          wrapperUserId: bob.id,
        },
      ],
      den,
      alice.id
    );
    expect(resolved[0]?.wrapperPublicKeyBase64).toBe("bob-pub");
  });

  test("falls back to the row snapshot when the wrapper has left the den", () => {
    const resolved = resolveMyConversationWraps(
      [
        {
          encryptedKey: { ciphertext: "ct", iv: "iv" },
          ownerUserId: alice.id,
          version: 1,
          wrapperPublicKey: "departed-pub",
          wrapperUserId: "departed",
        },
      ],
      den,
      alice.id
    );
    // The wrapper is gone from the roster and the identity row is unreachable, so
    // the denormalized snapshot is the only pairing that still exists.
    expect(resolved[0]?.wrapperPublicKeyBase64).toBe("departed-pub");
  });

  test("returns null for a wrapper that cannot be paired at all", () => {
    // No roster entry and no snapshot: there is nothing to pair with, so the wrap
    // must be dropped rather than paired with a guess.
    const resolved = resolveMyConversationWraps(
      [
        {
          encryptedKey: { ciphertext: "ct", iv: "iv" },
          ownerUserId: alice.id,
          version: 1,
          wrapperPublicKey: null,
          wrapperUserId: "vanished",
        },
      ],
      den,
      alice.id
    );
    expect(resolved[0]?.wrapperPublicKeyBase64).toBeNull();
  });

  test("keeps only my own rows, newest epoch first", () => {
    const resolved = resolveMyConversationWraps(
      [
        {
          encryptedKey: { ciphertext: "a", iv: "1" },
          ownerUserId: alice.id,
          version: 1,
        },
        {
          encryptedKey: { ciphertext: "b", iv: "2" },
          ownerUserId: bob.id,
          version: 3,
        },
        {
          encryptedKey: { ciphertext: "c", iv: "3" },
          ownerUserId: alice.id,
          version: 2,
        },
      ],
      den,
      alice.id
    );
    expect(resolved.map((wrap) => wrap.version)).toEqual([2, 1]);
    expect(resolved.map((wrap) => wrap.encryptedKey.ciphertext)).toEqual([
      "c",
      "a",
    ]);
  });

  test("treats a row with no version as epoch 1", () => {
    const resolved = resolveMyConversationWraps(
      [{ encryptedKey: { ciphertext: "a", iv: "1" }, ownerUserId: alice.id }],
      den,
      alice.id
    );
    expect(resolved[0]?.version).toBe(1);
  });
});

describe("createRootKeyStore for a den", () => {
  test("resolves each of my wraps through the member who made it", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const den = makeDenConversation("den-store", [alice, bob, carol]);
    const firstRoot = generateRootKey();
    const secondRoot = generateRootKey();

    // Alice's epoch-1 wrap was made by Bob, her epoch-2 wrap by Carol: two
    // different rotators, two different pairings, and both must resolve.
    const bobWrap = await wrapRootKey(
      bob.pair.privateKey,
      await importIdentityKey(alice.publicKeyBase64),
      den.id,
      firstRoot
    );
    const carolWrap = await wrapRootKey(
      carol.pair.privateKey,
      await importIdentityKey(alice.publicKeyBase64),
      den.id,
      secondRoot
    );
    const wraps = [
      {
        encryptedKey: bobWrap,
        version: 1,
        wrapperPublicKeyBase64: bob.publicKeyBase64,
      },
      {
        encryptedKey: carolWrap,
        version: 2,
        wrapperPublicKeyBase64: carol.publicKeyBase64,
      },
    ];

    const store = createRootKeyStore(alice.pair.privateKey);
    const roots = await store.getRootKeys(den.id, wraps, "");

    // Newest epoch first, both readable, both resolving to the same root key.
    expect(roots).toHaveLength(2);
    expect(
      Buffer.from(roots[0] ?? new Uint8Array()).equals(Buffer.from(secondRoot))
    ).toBe(true);
    expect(
      Buffer.from(roots[1] ?? new Uint8Array()).equals(Buffer.from(firstRoot))
    ).toBe(true);
  });

  test("drops the wrap whose wrapper cannot be paired, and keeps the rest", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const readable = generateRootKey();
    const readableWrap = await wrapRootKey(
      bob.pair.privateKey,
      await importIdentityKey(alice.publicKeyBase64),
      "den-partial",
      readable
    );
    const unreadableWrap = await wrapRootKey(
      bob.pair.privateKey,
      await importIdentityKey(alice.publicKeyBase64),
      "den-partial",
      generateRootKey()
    );

    const store = createRootKeyStore(alice.pair.privateKey);
    const roots = await store.getRootKeys(
      "den-partial",
      [
        // A wrapper who left with no snapshot: unpairable, so dropped rather than
        // fatal.
        { encryptedKey: unreadableWrap, version: 2 },
        {
          encryptedKey: readableWrap,
          version: 1,
          wrapperPublicKeyBase64: bob.publicKeyBase64,
        },
      ],
      ""
    );
    expect(roots).toHaveLength(1);
    expect(
      Buffer.from(roots[0] ?? new Uint8Array()).equals(Buffer.from(readable))
    ).toBe(true);
  });

  test("rejects only when nothing unwraps", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const wrap = await wrapRootKey(
      bob.pair.privateKey,
      await importIdentityKey(alice.publicKeyBase64),
      "den-nothing",
      generateRootKey()
    );
    const store = createRootKeyStore(alice.pair.privateKey);
    await expect(
      store.getRootKeys(
        "den-nothing",
        [{ encryptedKey: wrap, version: 1 }],
        // The wrong wrapper: the same ciphertext pairs with nobody here.
        "some-other-wrapper"
      )
    ).rejects.toThrow();
  });

  test("the cache signature covers the wrapper key, not just the ciphertext", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const carol = await makeIdentity();
    const rootKey = generateRootKey();
    const wrap = await wrapRootKey(
      carol.pair.privateKey,
      await importIdentityKey(alice.publicKeyBase64),
      "den-cache",
      rootKey
    );
    const store = createRootKeyStore(alice.pair.privateKey);

    const pairedWithCarol = await store.getRootKeys(
      "den-cache",
      [
        {
          encryptedKey: wrap,
          version: 1,
          wrapperPublicKeyBase64: carol.publicKeyBase64,
        },
      ],
      ""
    );
    expect(
      Buffer.from(pairedWithCarol[0] ?? new Uint8Array()).equals(
        Buffer.from(rootKey)
      )
    ).toBe(true);

    // Same conversation, same ciphertext, same version, different wrapper key: the
    // cached roots cannot be reused, or decryption would silently continue with a
    // pairing the row no longer names.
    await expect(
      store.getRootKeys(
        "den-cache",
        [
          {
            encryptedKey: wrap,
            version: 1,
            wrapperPublicKeyBase64: bob.publicKeyBase64,
          },
        ],
        ""
      )
    ).rejects.toThrow();
  });

  test("re-derives when the wrapper's key rotates under the same conversation", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const rotatedBob = await makeIdentity();
    const rootKey = generateRootKey();
    const wrap = await wrapRootKey(
      rotatedBob.pair.privateKey,
      await importIdentityKey(alice.publicKeyBase64),
      "den-rotate-wrapper",
      rootKey
    );
    const store = createRootKeyStore(alice.pair.privateKey);

    const roots = await store.getRootKeys(
      "den-rotate-wrapper",
      [
        {
          encryptedKey: wrap,
          version: 1,
          wrapperPublicKeyBase64: rotatedBob.publicKeyBase64,
        },
      ],
      ""
    );
    expect(
      Buffer.from(roots[0] ?? new Uint8Array()).equals(Buffer.from(rootKey))
    ).toBe(true);

    // Bob reset their identity: the same row now resolves against his new key, so
    // the cached answer for the old one must not survive.
    await expect(
      store.getRootKeys(
        "den-rotate-wrapper",
        [
          {
            encryptedKey: wrap,
            version: 1,
            wrapperPublicKeyBase64: bob.publicKeyBase64,
          },
        ],
        ""
      )
    ).rejects.toThrow();
  });
});

function pages(messages: { id: string }[]) {
  return [{ messages: [{ id: "older-1" }] }, { messages }];
}

describe("appendMessageToLastPage", () => {
  test("appends to the last page", () => {
    const next = appendMessageToLastPage(pages([{ id: "m1" }]), { id: "m2" });
    expect(next).not.toBeNull();
    expect(next?.at(-1)?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  test("returns null (no change) when the message is already present", () => {
    const existing = [{ id: "m1" }];
    expect(appendMessageToLastPage(pages(existing), { id: "m1" })).toBeNull();
  });

  test("dedupes against the sender's optimistic fold of the same SSE echo", () => {
    // SSE echo landed first.
    const next = appendMessageToLastPage(pages([{ id: "m1" }]), { id: "m1" });
    expect(next).toBeNull();
    // Fold landed first.
    const afterFold = appendMessageToLastPage(pages([{ id: "m1" }]), {
      id: "m2",
    });
    expect(afterFold?.at(-1)?.messages).toHaveLength(2);
    const duplicateEcho = appendMessageToLastPage(afterFold ?? [], {
      id: "m2",
    });
    expect(duplicateEcho).toBeNull();
  });

  test("handles an empty page list", () => {
    expect(appendMessageToLastPage([], { id: "m1" })).toBeNull();
  });
});

// A message as it arrives on the wire: ISO strings where the cache is typed as
// Dates. Both fold call sites hand this shape in - the composer's POST response
// and the thread's SSE frame.
function wireRow(id: string, createdAt: string) {
  return {
    ciphertext: "c",
    conversationId: "convo-1",
    createdAt,
    deletedAt: null,
    editedAt: null,
    id,
    iv: "i",
    ratchetIndex: 0,
    senderId: "me",
  };
}

// The same row as the FETCHING path hands it over: already normalized, because
// `fetchMessages` revives every row it reads.
function fetchedRow(id: string, createdAt: string) {
  return { ...wireRow(id, createdAt), createdAt: new Date(createdAt) };
}

describe("foldMessageIntoPages", () => {
  // The composer used to skip normalization, so a sent row entered the cache with
  // an ISO string where the transcript's merge expected a Date - and a row it
  // cannot compare against the rows around it lands wherever the append put it.
  test("normalizes the timestamps the row arrives with", () => {
    const next = foldMessageIntoPages(
      [{ messages: [fetchedRow("m-1", "2026-01-01T00:00:00.000Z")] }],
      wireRow("m-2", "2026-01-02T00:00:00.000Z")
    );
    const folded = next?.at(-1)?.messages.at(-1);
    expect(folded?.createdAt).toBeInstanceOf(Date);
    expect(folded?.createdAt.getTime()).toBe(
      new Date("2026-01-02T00:00:00.000Z").getTime()
    );
  });

  test("a folded row is comparable with a fetched one beside it", () => {
    // What the transcript's merge actually does, stated as a test because both the
    // misplacement and a whole-thread crash were this comparison meeting a string.
    const next = foldMessageIntoPages(
      [{ messages: [fetchedRow("m-1", "2026-01-01T00:00:00.000Z")] }],
      wireRow("m-2", "2026-01-02T00:00:00.000Z")
    );
    const rows = next?.at(-1)?.messages ?? [];
    const ascending = rows.every((row, index) => {
      const previous = rows[index - 1];
      return (
        index === 0 ||
        row.createdAt.getTime() >= (previous?.createdAt.getTime() ?? 0)
      );
    });
    expect(ascending).toBe(true);
    // And it is genuinely the newest, which is the placement the send must have.
    expect(rows.at(-1)?.id).toBe("m-2");
  });

  test("still dedupes the sender's own SSE echo", () => {
    const first = foldMessageIntoPages(
      [{ messages: [] }],
      wireRow("m-2", "2026-01-02T00:00:00.000Z")
    );
    expect(
      foldMessageIntoPages(
        first ?? [],
        wireRow("m-2", "2026-01-02T00:00:00.000Z")
      )
    ).toBeNull();
  });
});

describe("updateMessageInPages", () => {
  test("replaces the matching row in place, preserving order", () => {
    const next = updateMessageInPages(pages([{ id: "m1" }, { id: "m2" }]), {
      id: "m1",
    });
    expect(next).not.toBeNull();
    expect(next?.[1].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  test("finds the row in an earlier page", () => {
    const next = updateMessageInPages(pages([{ id: "m2" }]), { id: "older-1" });
    expect(next).not.toBeNull();
    expect(next?.[0].messages.map((m) => m.id)).toEqual(["older-1"]);
  });

  test("returns null when no page holds the id", () => {
    expect(
      updateMessageInPages(pages([{ id: "m1" }]), { id: "missing" })
    ).toBeNull();
  });

  test("handles an empty page list", () => {
    expect(updateMessageInPages([], { id: "m1" })).toBeNull();
  });

  test("does not mutate the input pages", () => {
    const input = pages([{ id: "m1" }]);
    const next = updateMessageInPages(input, { edited: true, id: "m1" } as {
      id: string;
    });
    expect(next).not.toBeNull();
    expect(input[1].messages[0]).toEqual({ id: "m1" });
  });
});

describe("removeMessagesFromPages", () => {
  test("removes rows across pages and keeps the rest", () => {
    const next = removeMessagesFromPages(
      pages([{ id: "m1" }, { id: "m2" }]),
      new Set(["m1"])
    );
    expect(next).not.toBeNull();
    expect(next?.[0]?.messages.map((m) => m.id)).toEqual(["older-1"]);
    expect(next?.[1]?.messages.map((m) => m.id)).toEqual(["m2"]);
  });

  test("returns null when nothing matched", () => {
    expect(
      removeMessagesFromPages(pages([{ id: "m1" }]), new Set(["ghost"]))
    ).toBeNull();
  });

  test("drops rows from every page", () => {
    const next = removeMessagesFromPages(
      pages([{ id: "m1" }]),
      new Set(["older-1", "m1"])
    );
    expect(next?.[0]?.messages).toEqual([]);
    expect(next?.[1]?.messages).toEqual([]);
  });
});

function pagesWithDeletedAt() {
  return [
    { messages: [{ deletedAt: null, id: "older-1" }] },
    {
      messages: [
        { deletedAt: null, id: "m1" },
        { deletedAt: null, id: "m2" },
      ],
    },
  ];
}

describe("markMessagesDeletedInPages", () => {
  test("marks matching rows deleted in place, preserving order", () => {
    const deletedAt = new Date("2026-01-01T00:00:00.000Z");
    const next = markMessagesDeletedInPages(
      pagesWithDeletedAt(),
      new Set(["m2"]),
      deletedAt
    );
    expect(next?.[0]?.messages[0]).toEqual({ deletedAt: null, id: "older-1" });
    expect(next?.[1]?.messages[0]).toEqual({ deletedAt: null, id: "m1" });
    expect(next?.[1]?.messages[1]).toEqual({ deletedAt, id: "m2" });
  });

  test("returns null when no row matched", () => {
    expect(
      markMessagesDeletedInPages(
        pagesWithDeletedAt(),
        new Set(["ghost"]),
        new Date()
      )
    ).toBeNull();
  });
});

describe("reencryptMessageForEdit", () => {
  const conversationId = "convo-edit";

  test("re-encrypts under the epoch that owns the message", async () => {
    const rootKey = generateRootKey();
    const current = await encryptMessage(rootKey, "alice", 3, conversationId, {
      content: "before",
      type: "text",
    });
    const edited = await reencryptMessageForEdit({
      conversationId,
      current,
      editedPayload: { content: "after", type: "text" },
      rootKeys: [rootKey],
      senderId: "alice",
    });
    expect(edited).not.toBeNull();
    // Same ratchet index: the row's key derivation must not shift.
    expect(edited?.ratchetIndex).toBe(3);
    // A fresh IV is generated for the rewrite.
    expect(edited?.iv).not.toBe(current.iv);
  });

  test("picks the right epoch among several and keeps it readable", async () => {
    const oldRoot = generateRootKey();
    const newRoot = generateRootKey();
    // The message was sent under the OLD epoch.
    const current = await encryptMessage(oldRoot, "alice", 0, conversationId, {
      content: "before",
      type: "text",
    });
    const edited = await reencryptMessageForEdit({
      conversationId,
      current,
      editedPayload: { content: "after", type: "text" },
      // Newest epoch first, exactly what the root store returns.
      rootKeys: [newRoot, oldRoot],
      senderId: "alice",
    });
    expect(edited).not.toBeNull();
    const roundTripped = await decryptMessage(
      oldRoot,
      "alice",
      conversationId,
      edited ?? current
    );
    expect(roundTripped).toEqual({ content: "after", type: "text" });
  });

  test("returns null when no available epoch can read the message", async () => {
    const ownerRoot = generateRootKey();
    const strangerRoot = generateRootKey();
    const current = await encryptMessage(
      ownerRoot,
      "alice",
      0,
      conversationId,
      { content: "before", type: "text" }
    );
    const edited = await reencryptMessageForEdit({
      conversationId,
      current,
      editedPayload: { content: "after", type: "text" },
      rootKeys: [strangerRoot],
      senderId: "alice",
    });
    expect(edited).toBeNull();
  });

  test("preserves a media payload's album when only the caption changes", async () => {
    const rootKey = generateRootKey();
    const images = [{ url: "/api/media/cm1" }];
    const current = await encryptMessage(rootKey, "alice", 0, conversationId, {
      content: "old",
      images,
      kind: "image",
      type: "media",
    });
    const edited = await reencryptMessageForEdit({
      conversationId,
      current,
      editedPayload: { content: "new", images, kind: "image", type: "media" },
      rootKeys: [rootKey],
      senderId: "alice",
    });
    const roundTripped = await decryptMessage(
      rootKey,
      "alice",
      conversationId,
      edited ?? current
    );
    expect(roundTripped).toEqual({
      content: "new",
      images,
      kind: "image",
      type: "media",
    });
  });
});

describe("createRootKeyStore for the edit path", () => {
  test("unwraps every readable epoch and drops stale wraps", async () => {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const oldAlice = await makeIdentity();
    const oldRoot = generateRootKey();
    const newRoot = generateRootKey();

    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const stale = await wrapRootKey(
      oldAlice.pair.privateKey,
      bobKey,
      "convo-roots",
      oldRoot
    );
    const current = await wrapRootKey(
      alice.pair.privateKey,
      bobKey,
      "convo-roots",
      newRoot
    );

    const store = createRootKeyStore(alice.pair.privateKey);
    const roots = await store.getRootKeys(
      "convo-roots",
      [
        { encryptedKey: stale, version: 1 },
        { encryptedKey: current, version: 2 },
      ],
      bob.publicKeyBase64
    );
    // Newest first; the stale v1 (superseded identity) is dropped.
    expect(roots).toHaveLength(1);
    expect(Buffer.from(roots[0]).equals(Buffer.from(newRoot))).toBe(true);
  });

  test("rejects when nothing unwraps so the caller can refuse the edit", async () => {
    const alice = await makeIdentity();
    const oldAlice = await makeIdentity();
    const bob = await makeIdentity();
    const bobPub = await publicKeyBase64ToJwk(bob.publicKeyBase64);
    const bobKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      bobPub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const stale = await wrapRootKey(
      oldAlice.pair.privateKey,
      bobKey,
      "convo-bad",
      generateRootKey()
    );
    const store = createRootKeyStore(alice.pair.privateKey);
    await expect(
      store.getRootKeys(
        "convo-bad",
        [{ encryptedKey: stale, version: 1 }],
        bob.publicKeyBase64
      )
    ).rejects.toThrow();
  });
});

describe("a snapshot the server has already moved past", () => {
  // A den's roster is the only input to "may this epoch still be written into", and
  // a membership mutation moves it while the client's cached detail stays exactly
  // as it was. The removed member is still listed, the epoch they hold shows no
  // departed holder, and there is no newcomer to force a rotation — so nothing in
  // the snapshot says the send is wrong. The conversation row's timestamp does.
  const originalFetch = globalThis.fetch;
  const posted: {
    encryptedKey: EncryptedBlob;
    ownerUserId: string;
    version?: number;
    wrapperPublicKey?: string | null;
    wrapperUserId?: string | null;
  }[] = [];
  const fetchMock = mock((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/keys")) {
      const body = JSON.parse(String(init?.body)) as { keys: typeof posted };
      posted.push(...body.keys);
      return Response.json({ applied: body.keys.length, ok: true });
    }
    if (url.includes("/api/messages/conversations/") && lastDetailResponse) {
      return Response.json(lastDetailResponse, { status: 200 });
    }
    return Response.json({}, { status: 404 });
  });

  beforeEach(() => {
    lastDetailResponse = null;
    posted.length = 0;
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("refuses the send rather than writing into the epoch a removed member holds", async () => {
    const { alice, carol, den, leaked, rootKey } =
      await makeRemovalFixture("den-stale-1");
    await announceRemoval(den, carol.id);

    // The cached snapshot is now known-stale, and there is no way to refetch, so
    // the send is refused rather than made.
    expect(isConversationSnapshotStale(den)).toBe(true);
    expect(
      await ensureConversationKeys(den, alice.pair.privateKey, alice.id)
    ).toBeNull();
    // Nothing was written under the contaminated epoch, which is the whole point:
    // Carol still holds its root, and the caller was told not to send.
    expect(posted).toHaveLength(0);
    // The message already encrypted under that epoch is readable by the sender and
    // would still have been readable by Carol — which is why no new one may go out.
    expect(await readAsMember(alice, den, leaked, alice.id)).toEqual({
      content: "before carol was removed",
      type: "text",
    });
    expect(rootKey.byteLength).toBe(32);
  });

  test("refetches and rotates instead, so the send still goes out", async () => {
    const { alice, bob, carol, den, leaked } =
      await makeRemovalFixture("den-stale-2");
    const fresh = await announceRemoval(den, carol.id);

    const rootKeyForSend = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id,
      { refreshConversation: refetchConversationDetail }
    );

    expect(rootKeyForSend).not.toBeNull();
    // A fresh epoch for the two who remain, and Carol is not named by any of it.
    expect(posted.map((key) => key.version)).toEqual([2, 2]);
    expect(posted.map((key) => key.ownerUserId).toSorted()).toEqual(
      [alice.id, bob.id].toSorted()
    );
    const sent = await encryptMessage(
      rootKeyForSend ?? generateRootKey(),
      alice.id,
      0,
      den.id,
      { content: "after carol was removed", type: "text" }
    );
    // Bob reads the new message...
    const bobView = {
      ...fresh,
      keys: [...den.keys, ...storedFromPosted(fresh, posted)],
    };
    expect(await readAsMember(bob, bobView, sent, alice.id)).toEqual({
      content: "after carol was removed",
      type: "text",
    });
    // ...and still reads what was sent before the removal, because a key row hangs
    // off the conversation rather than the membership: their history is theirs.
    expect(await readAsMember(bob, bobView, leaked, alice.id)).toEqual({
      content: "before carol was removed",
      type: "text",
    });

    // Carol holds epoch 1 and no epoch 2, so the message that went out after her
    // removal is not hers to read. That is the property the rotation bought, and
    // the reason the stale snapshot had to be refused rather than trusted.
    expect(await readAsMember(carol, den, sent, alice.id)).toBeNull();
    expect(await readAsMember(carol, den, leaked, alice.id)).toEqual({
      content: "before carol was removed",
      type: "text",
    });
  });
});

// The roster counter as the client uses it, end to end through the real helpers.
//
// The gap the timestamp cannot close: pub/sub is best-effort, so a
// `den.membership.changed` can simply never arrive. The only responses a member
// with that thread open will ever see are the ones they ask for, so the send
// carries the counter and this tab compares it against what it last applied. When
// it comes back ahead, the cached conversation is holding a roster that no longer
// exists - and the send path has to know that BEFORE it chooses an epoch.
//
// Every case gets its own den id, because the counter this tab has applied is
// module state on purpose: the send path reads it from outside any component, so
// the ids are what keep these cases independent.

// One send, with the arguments spelled out at every call site so each test says
// which snapshot and which key it used.
async function sendOnce(
  conversation: MessageConversationData,
  rootKey: Uint8Array,
  senderId: string
) {
  await sendEncryptedMessage(conversation.id, rootKey, senderId, 0, {
    content: "hello",
    type: "text",
  });
}

describe("a roster counter learned from a response", () => {
  const originalFetch = globalThis.fetch;
  let detailPayload: MessageConversationData | null = null;
  let sendEcho: number | null | undefined = 0;
  let sent: { ciphertext: string; iv: string; ratchetIndex: number }[] = [];

  const fetchMock = mock((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/keys")) {
      const body = JSON.parse(String(init?.body)) as {
        keys: { encryptedKey: EncryptedBlob; ownerUserId: string }[];
      };
      return Response.json({ applied: body.keys.length, ok: true });
    }
    if (url.endsWith("/messages")) {
      const body = JSON.parse(String(init?.body)) as {
        ciphertext: string;
        iv: string;
        ratchetIndex: number;
      };
      sent.push(body);
      return Response.json(
        {
          membershipSeq: sendEcho,
          message: {
            ciphertext: body.ciphertext,
            conversationId: "convo-1",
            createdAt: FIXTURE_INSTANT.toISOString(),
            deletedAt: null,
            editedAt: null,
            id: "m-1",
            iv: body.iv,
            ratchetIndex: body.ratchetIndex,
            senderId: "alice",
          },
        },
        { status: 201 }
      );
    }
    if (url.includes("/api/messages/conversations/")) {
      return detailPayload
        ? Response.json({ conversation: detailPayload }, { status: 200 })
        : Response.json({}, { status: 404 });
    }
    return Response.json({}, { status: 404 });
  });

  beforeEach(() => {
    detailPayload = null;
    sendEcho = 0;
    sent = [];
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  // A two-member den holding one healthy epoch, which is what every case below
  // starts from: the subject is the client's bookkeeping, not the crypto.
  async function makeEchoFixture(id: string) {
    const alice = await makeIdentity();
    const bob = await makeIdentity();
    const den = makeDenConversation(id, [alice, bob]);
    den.membershipSeq = 0;
    const rootKey = generateRootKey();
    await fanOutEpoch(den, rootKey, alice, 1);
    return { alice, bob, den, rootKey };
  }

  // The tab's starting position: it holds a detail read taken while the roster was
  // still at 0, which is the only thing a real client has before anything moves.
  async function learnAtZero(den: MessageConversationData) {
    detailPayload = { ...den, membershipSeq: 0 };
    await fetchConversationDetail(den.id);
  }

  test("a send whose echo is ahead means an announcement was lost, and the next send refetches", async () => {
    // The whole point of the echo. The roster moved on the server, the event never
    // arrived, and this tab's detail still says the old roster - which offers as
    // sendable an epoch the removed member still holds. The send is already
    // committed, so what the echo buys is the refusal on the NEXT one.
    const { alice, den, rootKey } = await makeEchoFixture("den-echo-ahead");
    await learnAtZero(den);

    // The server moved to 1 and said nothing. The send reports it.
    sendEcho = 1;
    await sendOnce(den, rootKey, alice.id);

    expect(isConversationSnapshotStale(den)).toBe(true);
    // With no way to fetch a current answer, the send is refused rather than made
    // on a snapshot the server has already overtaken.
    expect(
      await ensureConversationKeys(den, alice.pair.privateKey, alice.id)
    ).toBeNull();

    // And with one, the detail is re-read BEFORE the epoch is chosen. That refetch
    // is the remedy: the client cannot ask which change it missed, only for the
    // roster again.
    let refreshes = 0;
    detailPayload = { ...den, membershipSeq: 1 };
    const key = await ensureConversationKeys(
      den,
      alice.pair.privateKey,
      alice.id,
      {
        refreshConversation: async () => {
          refreshes += 1;
          const fresh = await fetchConversationDetail(den.id);
          return fresh.conversation;
        },
      }
    );
    expect(refreshes).toBe(1);
    expect(key).not.toBeNull();
    // And it settles: the refetched payload carries the counter this tab had
    // already applied, so nothing is behind any more and the next send proceeds.
    expect(isConversationSnapshotStale(detailPayload ?? den)).toBe(false);
  });

  test("a send whose echo matches what this tab already applied changes nothing", async () => {
    // The ordinary send in a room nobody has touched. If this marked the snapshot
    // behind, every message in every den would cost a refetch on the next one.
    const { alice, den, rootKey } = await makeEchoFixture("den-echo-same");
    await learnAtZero(den);

    sendEcho = 0;
    await sendOnce(den, rootKey, alice.id);

    expect(isConversationSnapshotStale(den)).toBe(false);
    let refreshes = 0;
    expect(
      await ensureConversationKeys(den, alice.pair.privateKey, alice.id, {
        refreshConversation: () => {
          refreshes += 1;
          return null;
        },
      })
    ).not.toBeNull();
    expect(refreshes).toBe(0);
  });

  test("a send that reports no counter at all changes nothing either", async () => {
    // The graceful half: an older server, or a transaction that updated no row.
    // Null is "cannot tell", never a crash and never "assume fresh" - the tab
    // behaves exactly as it did before this field existed, which is to keep
    // sending against the snapshot it holds and rely on the timestamp guard.
    const { alice, den, rootKey } = await makeEchoFixture("den-echo-null");
    await learnAtZero(den);

    sendEcho = null;
    await sendOnce(den, rootKey, alice.id);

    expect(isConversationSnapshotStale(den)).toBe(false);
    expect(sent).toHaveLength(1);
  });

  test("a gap costs one refetch and then settles", async () => {
    // Two announcements were dropped and the third arrived. The client cannot know
    // which changes it missed, so it re-reads the roster once; the answer carries
    // the counter it just applied, so the next announcement about the same change
    // is a duplicate and buys nothing.
    const { den } = await makeEchoFixture("den-echo-gap");

    expect(applyMembershipSeq(den.id, 1).kind).toBe("first");
    expect(applyMembershipSeq(den.id, 5).kind).toBe("gap");

    // The refetch that answers the gap.
    detailPayload = { ...den, membershipSeq: 5 };
    await fetchConversationDetail(den.id);
    expect(isConversationSnapshotStale(den)).toBe(true);
    expect(isConversationSnapshotStale(detailPayload ?? den)).toBe(false);

    // The same announcement arriving twice - a retried publish, or a redelivered
    // frame - is a duplicate from here on, and so is anything older.
    expect(applyMembershipSeq(den.id, 5).kind).toBe("duplicate");
    expect(applyMembershipSeq(den.id, 4).kind).toBe("duplicate");
  });

  test("an announcement arriving out of order cannot undo the newer one", async () => {
    // Two events overtaken on the wire. The late one must not walk the counter
    // back, or the next real change would read as a gap this tab had already
    // answered.
    const { den } = await makeEchoFixture("den-echo-order");

    applyMembershipSeq(den.id, 2);
    const late = applyMembershipSeq(den.id, 1);

    // Ignored, so it cannot cost a second refetch of a roster the newer event has
    // already answered...
    expect(late).toMatchObject({ kind: "duplicate", refetchDetail: false });
    // ...and it did not walk the counter back either: had it, the next real change
    // (3) would read as a gap rather than the next one it is.
    expect(applyMembershipSeq(den.id, 3).kind).toBe("next");

    // The tab's own snapshot is still behind, which is the other half of the same
    // property: an event is not knowledge, only a reason to re-read. The refetch
    // answers with the newest value the server has, 3.
    detailPayload = { ...den, membershipSeq: 3 };
    await fetchConversationDetail(den.id);
    expect(isConversationSnapshotStale(den)).toBe(true);
    expect(isConversationSnapshotStale(detailPayload ?? den)).toBe(false);
  });
});

// The composer's refresh: a refetch of the conversation detail, which is also what
// advances this tab's idea of how current the conversation is.
async function refetchConversationDetail() {
  const response = await fetchConversationDetail(
    lastDetailResponse?.conversation.id ?? ""
  );
  return response.conversation;
}

let lastDetailResponse: { conversation: MessageConversationData } | null = null;

// Everything a member can read, newest epoch first, and what they can open with it:
// the decryptor's own view, not the send path's.
async function readAsMember(
  member: { id: string; pair: CryptoKeyPair },
  conversation: MessageConversationData,
  message: EncryptedBlob & { ratchetIndex: number },
  senderId: string
) {
  const store = createRootKeyStore(member.pair.privateKey);
  let roots: Uint8Array[];
  try {
    roots = await store.getRootKeys(
      conversation.id,
      resolveMyConversationWraps(
        toWrappedKeyPayloads(conversation.keys),
        conversation,
        member.id
      ),
      ""
    );
  } catch {
    return null;
  }
  // oxlint-disable no-await-in-loop -- ordered epoch probe with early exit
  for (const root of roots) {
    try {
      return await decryptMessage(root, senderId, conversation.id, message);
    } catch {
      // Wrong epoch.
    }
  }
  // oxlint-enable no-await-in-loop
  return null;
}

async function makeRemovalFixture(id: string) {
  const [alice, bob, carol] = await Promise.all([
    makeIdentity(),
    makeIdentity(),
    makeIdentity(),
  ]);
  const den = makeDenConversation(id, [alice, bob, carol]);
  const rootKey = generateRootKey();
  await fanOutEpoch(den, rootKey, alice, 1);
  const leaked = await encryptMessage(rootKey, alice.id, 0, den.id, {
    content: "before carol was removed",
    type: "text",
  });
  return { alice, bob, carol, den, leaked, rootKey };
}

// Tells this tab the roster moved: the server's own copy no longer has the removed
// member, and the row's timestamp has moved with them.
async function announceRemoval(
  den: MessageConversationData,
  removedId: string
): Promise<MessageConversationData> {
  lastDetailResponse = {
    conversation: {
      ...den,
      members: den.members.filter((member) => member.userId !== removedId),
      updatedAt: new Date(FIXTURE_INSTANT.getTime() + 60_000),
    },
  };
  await fetchConversationDetail(den.id);
  return lastDetailResponse.conversation;
}

// The rows the posted batch would have left on file, so a test can hand them to
// the decryptor exactly as the server would on the next read. The blobs are the
// real ones from the request, which is what lets the assertion be about decryption
// rather than about a fixture.
function storedFromPosted(
  conversation: MessageConversationData,
  posted: readonly {
    encryptedKey: EncryptedBlob;
    ownerUserId: string;
    version?: number;
    wrapperPublicKey?: string | null;
    wrapperUserId?: string | null;
  }[]
) {
  return posted.map((key, index) =>
    makeKeyRow({
      conversationId: conversation.id,
      encryptedKey: key.encryptedKey.ciphertext,
      id: `rotated-${key.ownerUserId}-${index}`,
      iv: key.encryptedKey.iv,
      ownerUserId: key.ownerUserId,
      version: key.version ?? 1,
      wrapperPublicKey: key.wrapperPublicKey,
      wrapperUserId: key.wrapperUserId,
    })
  );
}

// A message exactly as a realtime frame carries it: ISO timestamps, not Dates.
function wireMessage(overrides: Record<string, unknown> = {}) {
  return {
    ciphertext: "c",
    conversationId: "den-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    editedAt: null,
    id: "m-1",
    iv: "v",
    ratchetIndex: 0,
    senderId: "u-1",
    ...overrides,
  } as unknown as MessageData;
}

describe("toCachedMessage", () => {
  // The realtime frames carry ISO strings and the cache is typed as Dates. Nothing
  // compared two timestamps until the transcript merged its membership lines in,
  // and that turned the mismatch into a whole-thread crash on the first message a
  // peer sent.

  test("turns a wire timestamp into a Date", () => {
    const cached = toCachedMessage(wireMessage());
    expect(cached.createdAt).toBeInstanceOf(Date);
    expect(cached.createdAt.getTime()).toBe(
      new Date("2026-01-01T00:00:00.000Z").getTime()
    );
  });

  test("leaves an absent optional timestamp null rather than an Invalid Date", () => {
    // `new Date(null)` is the epoch and `new Date(undefined)` is Invalid Date, so
    // a naive coercion turns "never edited" into a 1970 date that every
    // isWithinEditWindow comparison then reads as an ancient message.
    const cached = toCachedMessage(
      wireMessage({ deletedAt: undefined, editedAt: undefined })
    );
    expect(cached.deletedAt).toBeNull();
    expect(cached.editedAt).toBeNull();
  });

  test("coerces an edited row too, and round-trips an already-normalised one", () => {
    const edited = toCachedMessage(
      wireMessage({ editedAt: "2026-01-02T00:00:00.000Z" })
    );
    expect(edited.editedAt).toBeInstanceOf(Date);

    const once = toCachedMessage(wireMessage());
    const twice = toCachedMessage(once);
    expect(twice.createdAt.getTime()).toBe(once.createdAt.getTime());
  });
});
