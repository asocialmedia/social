import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db";

import {
  createRootKeyStore,
  ensureConversationKeys,
  resolveMyConversationWraps,
  toWrappedKeyPayloads,
} from "./client";
import type { WrappedKeyPayload } from "./client";
import {
  decryptMessage,
  encryptMessage,
  exportPublicKeyJwk,
  generateIdentityKeyPair,
  generateRootKey,
  publicKeyJwkToBase64,
  wrapRootKeyForMembers,
} from "./crypto";
import type { EncryptedMessage } from "./crypto";
import type { MessageConversationData } from "./types";

// End-to-end cover for a den's root-key epochs, against a fake key server that
// enforces the same rules the real route does: one conversation-wide version
// ceiling, create-only rows, a new version written whole or not at all, and a
// batch that is either applied or unwound.
//
// These are the properties that only show up once several members and several
// epochs interact — forward secrecy across a join and a removal, and two members
// racing to rotate — so they get their own harness rather than living as unit
// tests against a hand-built snapshot.
//
// Every fixture here is a real MessageConversationData. An `as never` on a
// conversation payload hides exactly the drift that matters here: the send path
// reads `createdAt` on both the key rows and the member rows, so a fixture that
// quietly dropped it turned "cannot tell when this epoch started" into "nobody
// joined late", and the whole heal path opened up.

const DEN_ID = "den-e2e";
const DM_ID = "dm-e2e";

// A row as the server holds it.
interface StoredKey {
  conversationId: string;
  createdAt: number;
  encryptedKey: string;
  iv: string;
  ownerUserId: string;
  version: number;
  wrapperPublicKey: string | null;
  wrapperUserId: string | null;
}

interface Member {
  createdAt: number;
  id: string;
  pair: CryptoKeyPair;
  publicKeyBase64: string;
  // The member's presence stints as the server would have read them off the
  // membership log. Unset means "inside since `createdAt`, never left" - the
  // one-stint window the row alone describes. Tests that model a leave-and-rejoin
  // set the two stints explicitly, because the row alone cannot.
  windows?: { after: number; before: number | null }[];
}

// The clock is explicit and monotonic so "joined after the epoch" is a fact about
// the fixture rather than a race against wall time.
const EPOCH_ONE_AT = Date.parse("2025-12-01T00:00:00.000Z");
let clock = EPOCH_ONE_AT;
// Moves the clock forward by a minute and reports where it landed: a membership
// mutation writes its timestamp this way.
function tick(): number {
  clock += 60_000;
  return clock;
}
// Sets the clock, so a test can put a membership join and the fan-out that covers
// the roster in the very same millisecond — which is what the real server does
// whenever the two transactions are close enough together. A batch is written at
// the clock's current instant and then advances it, so this lands the next write
// exactly here.
function setClock(instant: number): void {
  clock = instant;
}
function resetClock(): void {
  clock = EPOCH_ONE_AT;
}

// A Date that cannot be read. This is the shape a deleted or unparseable
// timestamp has over the wire: the column is non-nullable, so it cannot be
// absent, but it can arrive as something no calendar can make sense of.
function unreadableInstant(): Date {
  return new Date(Number.NaN);
}

async function makeMember(
  id: string,
  joinedAt: number = EPOCH_ONE_AT
): Promise<Member> {
  const pair = await generateIdentityKeyPair();
  return {
    createdAt: joinedAt,
    id,
    pair,
    publicKeyBase64: publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    ),
  };
}

async function makeMembers(count: number, joinedAt: number = EPOCH_ONE_AT) {
  return await Promise.all(
    Array.from({ length: count }, (_unused, index) =>
      makeMember(`member-${index}`, joinedAt)
    )
  );
}

const storedKeys: StoredKey[] = [];
let postsByUrl: { url: string; keys: WrappedKeyPayload[] }[] = [];
// How many rows each accepted batch actually stored, so a test can prove the race
// really was lost rather than merely survived.
let appliedCounts: number[] = [];
// Set to answer the next batch with a refusal instead of applying it, after
// committing whatever the test needs to have landed first. The route refuses a
// batch that would complete or contradict an epoch somebody else owns, and the
// client has to come back from that by sending under the winner's root rather than
// by telling the user their message failed.
let refuseNextPost: (() => Promise<void>) | null = null;

// Mirrors the keys route: the version ceiling is conversation-wide, a row is never
// overwritten, a new version is written whole, and a batch is applied whole or not
// at all.
async function applyBatch(conversationId: string, keys: WrappedKeyPayload[]) {
  if (refuseNextPost) {
    const refuse = refuseNextPost;
    refuseNextPost = null;
    await refuse();
    return Response.json(
      { error: "Another rotation claimed this epoch" },
      { status: 409 }
    );
  }
  return storeBatch(conversationId, keys);
}

function storeBatch(conversationId: string, keys: WrappedKeyPayload[]) {
  const rows = keys.map((key) => ({
    conversationId,
    encryptedKey: key.encryptedKey.ciphertext,
    iv: key.encryptedKey.iv,
    ownerUserId: key.ownerUserId,
    version: key.version ?? 1,
    wrapperPublicKey: key.wrapperPublicKey ?? null,
    wrapperUserId: key.wrapperUserId ?? null,
  }));
  let maxVersion = 0;
  for (const key of storedKeys) {
    maxVersion = Math.max(maxVersion, key.version);
  }
  if (rows.some((row) => row.version > maxVersion + 1)) {
    return Response.json({ error: "Invalid key version" }, { status: 409 });
  }
  const pairs = new Set(
    storedKeys.map((key) => `${key.ownerUserId}:${key.version}`)
  );
  const pending = rows.filter(
    (row) => !pairs.has(`${row.ownerUserId}:${row.version}`)
  );
  // A new version is written whole or refused. Half an epoch is not a smaller win,
  // it is an epoch somebody cannot read — and a version that exists in two halves
  // is two roots nobody can ever reconcile, because the ceiling is max+1 and the
  // version already exists.
  const mintingVersion = rows.some((row) => row.version > maxVersion);
  if (mintingVersion && pending.length !== rows.length) {
    return Response.json(
      { error: "Another rotation claimed this epoch" },
      { status: 409 }
    );
  }
  // One timestamp for the whole batch, the way Postgres' `now()` gives one
  // timestamp per transaction. Every row of one fan-out therefore carries the same
  // millisecond, which is what makes the membership/epoch boundary reachable at
  // all: `addDenMembers` writes a batch under one `now()` for the same reason.
  const writtenAt = clock;
  tick();
  for (const row of pending) {
    storedKeys.push({ ...row, createdAt: writtenAt });
  }
  // `applied` is how many rows this call stored, which is how a client learns its
  // rotation lost the race for the epoch.
  return Response.json({ applied: pending.length, ok: true });
}

const originalFetch = globalThis.fetch;
const fetchMock = mock(async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/keys")) {
    const body = JSON.parse(String(init?.body)) as {
      keys: WrappedKeyPayload[];
    };
    postsByUrl.push({ keys: body.keys, url });
    const response = await applyBatch(
      url.split("/keys")[0] ?? DEN_ID,
      body.keys
    );
    const applied = await response.clone().json();
    if (typeof applied.applied === "number") {
      appliedCounts.push(applied.applied);
    }
    return response;
  }
  return Response.json({}, { status: 404 });
});

beforeEach(() => {
  storedKeys.length = 0;
  postsByUrl = [];
  appliedCounts = [];
  refuseNextPost = null;
  resetClock();
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function profile(member: Member, publicKeyBase64: string | null) {
  return {
    avatarUrl: null,
    badge: null,
    badges: [],
    communityMemberships: [],
    displayName: member.id,
    id: member.id,
    messageIdentity: publicKeyBase64 ? { publicKey: publicKeyBase64 } : null,
    username: member.id,
  };
}

interface SnapshotOptions {
  id?: string;
  // A member on the roster with no identity row: nothing to wrap for.
  withoutIdentity?: string;
  type?: "DEN" | "DM";
}

// The snapshot a client is holding: the roster, plus every key row on file.
function snapshot(
  members: readonly Member[],
  options: SnapshotOptions = {}
): MessageConversationData {
  const id = options.id ?? DEN_ID;
  return {
    createdAt: new Date(EPOCH_ONE_AT),
    id,
    keys: storedKeys.map((key, index) => ({
      conversationId: key.conversationId,
      createdAt: new Date(key.createdAt),
      encryptedKey: key.encryptedKey,
      id: `${key.ownerUserId}:${key.version}:${index}`,
      iv: key.iv,
      ownerUserId: key.ownerUserId,
      ratchetCounter: 0,
      version: key.version,
      wrapperPublicKey: key.wrapperPublicKey,
      wrapperUserId: key.wrapperUserId,
    })),
    members: members.map((member) => ({
      conversationId: id,
      createdAt: new Date(member.createdAt),
      lastReadAt: null,
      // What the detail route would have attached: one bounded range per stint,
      // ISO on the wire. An unreadable instant becomes an unparseable string, the
      // same shape a deleted timestamp takes over the wire.
      membershipWindows: (
        member.windows ?? [{ after: member.createdAt, before: null }]
      ).map((window) => ({
        after: Number.isNaN(window.after)
          ? "not-a-date"
          : new Date(window.after).toISOString(),
        before:
          window.before === null ? null : new Date(window.before).toISOString(),
      })),
      user:
        member.id === options.withoutIdentity
          ? profile(member, null)
          : profile(member, member.publicKeyBase64),
      userId: member.id,
    })),
    pairKey:
      options.type === "DM"
        ? members
            .map((m) => m.id)
            .toSorted()
            .join(":")
        : null,
    type: options.type ?? "DEN",
    updatedAt: new Date(EPOCH_ONE_AT),
  };
}

// Removes a member's wrap rows, which is what an interrupted fan-out looks like
// on the server: the row is simply not there. Deleting rather than reassigning it
// to a phantom owner matters, because a phantom owner would also read as a
// departed holder and force a rotation for a reason that has nothing to do with
// the gap under test.
function forgetKeys(userId: string, version?: number): void {
  for (const [index, key] of storedKeys.entries()) {
    if (
      key.ownerUserId === userId &&
      (version === undefined || key.version === version)
    ) {
      storedKeys.splice(index, 1);
      return;
    }
  }
}

// Appends an epoch's rows directly, the way the server would if some other member's
// fan-out had committed. A test that builds the epoch itself rather than letting the
// send path mint it is not circular: the state under test is then the same for the
// old decision and the new one.
async function writeEpoch(params: {
  members: readonly Member[];
  rotator: Member;
  version: number;
  writtenAt: number;
}): Promise<Uint8Array> {
  const { members, rotator, version, writtenAt } = params;
  const rootKey = generateRootKey();
  const fanOut = await wrapRootKeyForMembers(
    rotator.pair.privateKey,
    members.map((member) => ({
      publicKeyBase64: member.publicKeyBase64,
      userId: member.id,
    })),
    DEN_ID,
    rootKey
  );
  for (const wrap of fanOut.wrapped) {
    storedKeys.push({
      conversationId: DEN_ID,
      createdAt: writtenAt,
      encryptedKey: wrap.encryptedKey.ciphertext,
      iv: wrap.encryptedKey.iv,
      ownerUserId: wrap.userId,
      version,
      wrapperPublicKey: rotator.publicKeyBase64,
      wrapperUserId: rotator.id,
    });
  }
  return rootKey;
}

// A member's identity after a reset: same account, new keypair, and therefore no
// existing wrap unwraps for them any more.
async function resetIdentity(member: Member): Promise<Member> {
  const pair = await generateIdentityKeyPair();
  return {
    createdAt: member.createdAt,
    id: member.id,
    pair,
    publicKeyBase64: publicKeyJwkToBase64(
      await exportPublicKeyJwk(pair.publicKey)
    ),
  };
}

// The single peer a DM row that names no wrapper is paired with. A den has no
// such thing, and pairing one of its rows against an arbitrary member would mint a
// wrap nobody can read.
function peerKeyFor(
  conversation: MessageConversationData,
  myUserId: string
): string {
  if (conversation.type !== "DM") {
    return "";
  }
  return (
    conversation.members.find((member) => member.userId !== myUserId)?.user
      .messageIdentity?.publicKey ?? ""
  );
}

// Every root key this member can read, newest epoch first — what the decryptor
// actually tries, and in the same order.
async function readableRoots(
  member: Member,
  conversation: MessageConversationData
): Promise<Uint8Array[]> {
  const store = createRootKeyStore(member.pair.privateKey);
  try {
    return await store.getRootKeys(
      conversation.id,
      resolveMyConversationWraps(
        toWrappedKeyPayloads(conversation.keys),
        conversation,
        member.id
      ),
      peerKeyFor(conversation, member.id)
    );
  } catch {
    return [];
  }
}

// Decrypts a message the way the thread does: try each readable epoch newest
// first, and a message nobody can read stays unreadable.
async function readMessage(
  member: Member,
  conversation: MessageConversationData,
  message: EncryptedMessage,
  senderId: string
) {
  // Newest epoch first, exactly as the decryptor tries them: a message sent under
  // an older epoch simply falls through to its own root. Sequential on purpose,
  // since each attempt has to know the previous one failed.
  const roots = await readableRoots(member, conversation);
  // oxlint-disable no-await-in-loop -- ordered epoch probe with early exit
  for (const root of roots) {
    try {
      return await decryptMessage(root, senderId, conversation.id, message);
    } catch {
      // Wrong epoch: fall through to the next one.
    }
  }
  // oxlint-enable no-await-in-loop
  return null;
}

async function writeMessage(
  rootKey: Uint8Array,
  senderId: string,
  conversationId: string,
  ratchetIndex: number,
  content: string
) {
  return await encryptMessage(rootKey, senderId, ratchetIndex, conversationId, {
    content,
    type: "text",
  });
}

// Runs the send path for one member: ensure the epoch, encrypt, return both.
//
// The refresh callback is the same one the composer passes: a refetch from the
// server before rotating, so a stale snapshot cannot mint a root that nobody (not
// even its author) can read.
async function send(
  member: Member,
  conversation: MessageConversationData,
  ratchetIndex: number,
  content: string,
  refresh?: () => Promise<MessageConversationData>
) {
  const rootKey = await ensureConversationKeys(
    conversation,
    member.pair.privateKey,
    member.id,
    refresh ? { refreshConversation: refresh } : undefined
  );
  if (!rootKey) {
    throw new Error(`${member.id} could not get a root key`);
  }
  return {
    message: await writeMessage(
      rootKey,
      member.id,
      conversation.id,
      ratchetIndex,
      content
    ),
    rootKey,
  };
}

// The roster every test shares, so a refresh callback can rebuild the live view.
// Set by each test before it sends.
let roster: readonly Member[] = [];

describe("den root-key epochs end to end", () => {
  test("a newly added member cannot read anything sent before they joined", async () => {
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob];
    let original = snapshot(roster);

    // Two messages in epoch 1, sent before Carol was ever in the room.
    const first = await send(alice, original, 0, "before carol joined");
    original = snapshot(roster);
    const second = await send(alice, original, 1, "still before carol");
    // One rotation for the pair, and nothing after it: the epoch was complete.
    expect(postsByUrl).toHaveLength(1);

    // Carol joins. Her membership row is written now, long after epoch 1.
    carol.createdAt = tick();
    roster = [alice, bob, carol];

    // Alice sends again: the roster changed, so the epoch cannot continue.
    const third = await send(alice, snapshot(roster), 2, "after carol joined");
    const withCarol = snapshot(roster);

    // Carol can read what came after she arrived...
    expect(
      await readMessage(carol, withCarol, third.message, alice.id)
    ).toEqual({
      content: "after carol joined",
      type: "text",
    });
    // ...and none of what came before. This is the whole point of giving her only
    // the newest epoch: epoch 1's root encrypts the two earlier messages, and she
    // was never handed it.
    expect(
      await readMessage(carol, withCarol, first.message, alice.id)
    ).toBeNull();
    expect(
      await readMessage(carol, withCarol, second.message, alice.id)
    ).toBeNull();
    // Her wraps are epoch 2 only. Nothing in her history reaches back to epoch 1.
    expect(
      storedKeys.filter(
        (key) => key.ownerUserId === carol.id && key.version === 1
      )
    ).toHaveLength(0);
    // And the members who were there keep all of it.
    expect(
      await readMessage(alice, withCarol, first.message, alice.id)
    ).toEqual({
      content: "before carol joined",
      type: "text",
    });
  });

  test("the newest member in cannot read the past even when they send first", async () => {
    // The other order. Carol holds nothing at all, so her own send is what mints
    // the epoch she joins — and what she receives is still only that epoch.
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob];
    const secret = await send(
      alice,
      snapshot(roster),
      0,
      "before carol existed"
    );

    carol.createdAt = tick();
    roster = [alice, bob, carol];
    const hello = await send(carol, snapshot(roster), 0, "hi everyone");
    const withCarol = snapshot(roster);

    expect(
      await readMessage(alice, withCarol, hello.message, carol.id)
    ).toEqual({
      content: "hi everyone",
      type: "text",
    });
    expect(
      await readMessage(carol, withCarol, secret.message, alice.id)
    ).toBeNull();
    // Exactly one rotation, and it covered the whole roster including Carol.
    expect(storedKeys.filter((key) => key.version === 2)).toHaveLength(3);
    expect(Math.max(...storedKeys.map((key) => key.version))).toBe(2);
  });

  test("a removed member keeps their history and gains nothing after removal", async () => {
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob, carol];
    const shared = await send(
      alice,
      snapshot(roster),
      0,
      "while bob was a member"
    );
    const alsoShared = await send(bob, snapshot(roster), 0, "bob replies");

    // Bob is removed. His key rows stay on file: they are his history, and the
    // reset path depends on the same shape.
    roster = [alice, carol];
    const afterMessage = await send(
      alice,
      snapshot(roster),
      1,
      "bob cannot read this"
    );
    const bobsView = snapshot(roster);
    // Everything from before he left is still his to read.
    expect(await readMessage(bob, bobsView, shared.message, alice.id)).toEqual({
      content: "while bob was a member",
      type: "text",
    });
    expect(
      await readMessage(bob, bobsView, alsoShared.message, bob.id)
    ).toEqual({
      content: "bob replies",
      type: "text",
    });
    // Nothing after it. Bob still holds epoch 1's root, so the only way to keep
    // him out of the new messages is for the den to move to an epoch he never got.
    expect(
      await readMessage(bob, bobsView, afterMessage.message, alice.id)
    ).toBeNull();
    expect(
      storedKeys.filter(
        (key) => key.ownerUserId === bob.id && key.version === 2
      )
    ).toHaveLength(0);
    // Alice and Carol read both sides of the removal.
    expect(
      await readMessage(carol, bobsView, afterMessage.message, alice.id)
    ).toEqual({ content: "bob cannot read this", type: "text" });
    expect(
      await readMessage(carol, bobsView, shared.message, alice.id)
    ).toEqual({
      content: "while bob was a member",
      type: "text",
    });
  });

  test("a member who joined in the same millisecond as the rotation gets its own epoch", async () => {
    // The millisecond boundary. A batch of members is written under one `now()`, so
    // a join can land in exactly the same millisecond as the fan-out that covers
    // the roster before it. A strict `joinedAt > epochStart` read calls them a
    // member of the room and heals the epoch they must never see.
    //
    // The epoch is written by the harness rather than by the send under test, so
    // the state on the table is the same whichever way the decision goes.
    const [alice, bob, carol, dave] = await makeMembers(4);
    roster = [alice, bob];
    const secret = await send(alice, snapshot(roster), 0, "before the rush");

    // Carol and Dave join, and the fan-out that covers the new roster is written
    // in that same millisecond. Both new members' wraps are lost with it.
    const joinedAt = tick();
    carol.createdAt = joinedAt;
    dave.createdAt = joinedAt;
    setClock(joinedAt);
    roster = [alice, bob, carol, dave];
    await writeEpoch({
      members: [alice, bob],
      rotator: alice,
      version: 2,
      writtenAt: joinedAt,
    });
    // The premise, asserted rather than assumed: the join and the epoch it is
    // compared against carry the identical instant, so no clock comparison can
    // order them.
    expect(
      Math.min(
        ...storedKeys
          .filter((key) => key.version === 2)
          .map((key) => key.createdAt)
      )
    ).toBe(joinedAt);
    expect(carol.createdAt).toBe(joinedAt);
    expect(dave.createdAt).toBe(joinedAt);

    const afterMessage = await send(
      alice,
      snapshot(roster),
      1,
      "after the rush"
    );
    const view = snapshot(roster);
    // A rotation, not a heal: the epoch that landed in the joiners' millisecond
    // stays at two, and a fresh one covers all four.
    const newest = Math.max(...storedKeys.map((key) => key.version));
    expect(newest).toBe(3);
    // They read what came after, and nothing before. A heal would have handed them
    // epoch 2's root, which encrypts everything before they arrived.
    const reads = await Promise.all(
      [carol, dave].map(async (newcomer) => ({
        after: await readMessage(
          newcomer,
          view,
          afterMessage.message,
          alice.id
        ),
        before: await readMessage(newcomer, view, secret.message, alice.id),
        // Exactly one wrap, for the newest epoch: no epoch-1 row, no epoch-2 row.
        wraps: storedKeys.filter((key) => key.ownerUserId === newcomer.id),
      }))
    );
    for (const read of reads) {
      expect(read.after).toEqual({ content: "after the rush", type: "text" });
      expect(read.before).toBeNull();
      expect(read.wraps).toHaveLength(1);
      expect(read.wraps[0]?.version).toBe(newest);
    }
    // One rotation for four, and not a second one to correct the first: the
    // rotation covers the newcomers, so the very next send is back to a single
    // unwrap with no write.
    expect(storedKeys.filter((key) => key.version === newest)).toHaveLength(4);
    expect(postsByUrl).toHaveLength(2);
    // oxlint-disable-next-line no-await-in-loop -- one send at a time, each checked against the state the previous one left
    await send(alice, snapshot(roster), 2, "and nothing more");
    expect(postsByUrl).toHaveLength(2);
    expect(Math.max(...storedKeys.map((key) => key.version))).toBe(newest);
  });

  test("a join stamped at the exact instant the epoch started is still a join", async () => {
    // The same boundary stated as equality rather than as a shared millisecond:
    // `joinedAt === epochStart` used to read as "in the room before the epoch".
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob];
    const secret = await send(alice, snapshot(roster), 0, "before carol");

    const epochStart = Math.min(
      ...storedKeys.filter((key) => key.version === 1).map((k) => k.createdAt)
    );
    carol.createdAt = epochStart;
    roster = [alice, bob, carol];

    const afterMessage = await send(alice, snapshot(roster), 1, "after carol");
    const view = snapshot(roster);

    expect(await readMessage(carol, view, secret.message, alice.id)).toBeNull();
    expect(
      await readMessage(carol, view, afterMessage.message, alice.id)
    ).toEqual({ content: "after carol", type: "text" });
    // A rotation, not a heal: her wraps are epoch 2 only.
    expect(
      storedKeys.filter((key) => key.ownerUserId === carol.id)
    ).toHaveLength(1);
    expect(storedKeys.at(-1)?.version).toBe(2);
  });

  test("a rejoining member stamped in the epoch's own millisecond gets a new one", async () => {
    // The remaining shape the wrap set alone cannot separate: the member already
    // holds an epoch, so their presence looks like an interrupted fan-out, and
    // their membership row carries the identical instant the current epoch was
    // written in. Two events the database put in the same millisecond cannot be
    // ordered against each other, so equality has to read as "at or after", not as
    // "before".
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob, carol];
    await send(alice, snapshot(roster), 0, "epoch one");
    // Carol's membership row is rewritten at the very instant the second epoch is
    // fanned out, and her second-epoch wrap is lost with the fan-out.
    const sameInstant = tick();
    const gap = await send(
      alice,
      snapshot([alice, bob]),
      1,
      "after carol left"
    );
    carol.createdAt = sameInstant;
    roster = [alice, bob, carol];
    const rejoined = snapshot(roster);
    rejoined.keys = rejoined.keys.map((key) =>
      key.version === 2 ? { ...key, createdAt: new Date(sameInstant) } : key
    );
    expect(
      Math.min(
        ...rejoined.keys
          .filter((key) => key.version === 2)
          .map((key) => key.createdAt.getTime())
      )
    ).toBe(sameInstant);

    const back = await send(alice, rejoined, 2, "welcome back");
    const view = snapshot(roster);

    // A rotation, not a heal. The message written under the epoch she missed is not
    // hers to read.
    expect(Math.max(...storedKeys.map((key) => key.version))).toBe(3);
    expect(await readMessage(carol, view, gap.message, alice.id)).toBeNull();
    expect(await readMessage(carol, view, back.message, alice.id)).toEqual({
      content: "welcome back",
      type: "text",
    });
  });

  test("an unreadable timestamp on one key row blocks every heal", async () => {
    // "Cannot tell" has to mean rotate. The old discriminator read a row with an
    // unreadable createdAt as "no newcomers", and the heal then wrapped the
    // current root for every member missing one — so a single unreadable row
    // anywhere in the epoch turned the control into a full pre-join history leak.
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob, carol];
    // Epoch 1 covers the trio.
    await send(alice, snapshot(roster), 0, "epoch one");
    // Carol leaves and the epoch she holds is contaminated, so it is left alone
    // and epoch 2 covers the pair. Carol keeps epoch 1.
    const duringTheGap = await send(
      alice,
      snapshot([alice, bob]),
      1,
      "after carol left"
    );
    expect(storedKeys.filter((key) => key.version === 2)).toHaveLength(2);
    // Carol is back with her old membership row, which predates epoch 2. That
    // makes her a heal candidate on every signal the old code read, so the only
    // thing that can stop the heal is the unreadable timestamp.
    const joinedBefore = carol.createdAt;
    expect(joinedBefore).toBeLessThan(
      Math.min(
        ...storedKeys
          .filter((key) => key.version === 2)
          .map((key) => key.createdAt)
      )
    );
    roster = [alice, bob, carol];
    const damaged = snapshot(roster);
    const newest = Math.max(...damaged.keys.map((key) => key.version));
    damaged.keys = damaged.keys.map((key) =>
      key.version === newest ? { ...key, createdAt: unreadableInstant() } : key
    );

    const afterDamage = await send(alice, damaged, 2, "after the damage");
    const view = snapshot(roster);

    // The unreadable rows did not unlock a heal: a whole new epoch was minted.
    expect(Math.max(...storedKeys.map((key) => key.version))).toBe(newest + 1);
    // Carol never received the epoch she was missing, so the message written
    // under it is still not hers to read.
    expect(
      await readMessage(carol, view, duringTheGap.message, alice.id)
    ).toBeNull();
    expect(
      await readMessage(carol, view, afterDamage.message, alice.id)
    ).toEqual({ content: "after the damage", type: "text" });
  });

  test("a member who left and came back gets a new epoch, not the one they missed", async () => {
    // The rejoin. Their old wraps survive the round trip, because a key row hangs
    // off the conversation rather than the membership, so the wrap set alone cannot
    // distinguish them from an interrupted fan-out. The membership row cannot
    // either: a rejoin clears `leftAt` on the ORIGINAL row, so `createdAt` is
    // still the first join and reads as "present since before the gap". Only the
    // presence windows the server reads off the membership log are decisive here.
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob, carol];
    const whileTheyWereIn = await send(
      alice,
      snapshot(roster),
      0,
      "while carol was in the room"
    );
    const leftAt = tick();
    roster = [alice, bob];
    const duringTheGap = await send(
      alice,
      snapshot(roster),
      1,
      "after carol left"
    );

    // Carol is back, with the epoch they left on still in their pocket. The row
    // keeps the FIRST join, exactly as the service writes it; the gap is carried
    // by the windows alone.
    const rejoinedAt = tick();
    carol.windows = [
      { after: EPOCH_ONE_AT, before: leftAt },
      { after: rejoinedAt, before: null },
    ];
    roster = [alice, bob, carol];
    const afterRejoin = await send(alice, snapshot(roster), 2, "welcome back");
    const view = snapshot(roster);

    // Carol reads everything from before they left, and nothing from the gap they
    // were not in the room for. A heal here would have handed them epoch 2's root.
    expect(
      await readMessage(carol, view, whileTheyWereIn.message, alice.id)
    ).toEqual({ content: "while carol was in the room", type: "text" });
    expect(
      await readMessage(carol, view, duringTheGap.message, alice.id)
    ).toBeNull();
    expect(
      await readMessage(carol, view, afterRejoin.message, alice.id)
    ).toEqual({ content: "welcome back", type: "text" });
    expect(
      storedKeys.filter(
        (key) => key.ownerUserId === carol.id && key.version === 2
      )
    ).toHaveLength(0);
    expect(
      storedKeys.filter((key) => key.ownerUserId === carol.id)
    ).toHaveLength(2);
  });

  test("an interrupted fan-out is healed rather than rotated away", async () => {
    // The heal, end to end. The epoch stays the epoch, and the one member missing
    // a wrap is handed the root they were already entitled to: they were on the
    // roster, they hold the older epoch, and their membership row predates this
    // one.
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob, carol];
    await send(alice, snapshot(roster), 0, "epoch one");
    // Carol leaves, which contaminates epoch 1, so the next epoch covers the pair.
    const current = await send(alice, snapshot([alice, bob]), 1, "epoch two");
    expect(storedKeys.filter((key) => key.version === 2)).toHaveLength(2);

    // Carol is back before epoch 2 was minted, holding only epoch 1. Nothing
    // distinguishes this from an interrupted fan-out, which is the point: both are
    // the same heal.
    roster = [alice, bob, carol];
    expect(carol.createdAt).toBeLessThan(
      Math.min(
        ...storedKeys
          .filter((key) => key.version === 2)
          .map((key) => key.createdAt)
      )
    );
    const healed = await send(alice, snapshot(roster), 2, "after the heal");

    expect(
      Buffer.from(healed.rootKey).equals(Buffer.from(current.rootKey))
    ).toBe(true);
    // One rotation, one rotation, one heal: three batches, and the last one is a
    // single wrap at the epoch already in use.
    expect(postsByUrl).toHaveLength(3);
    expect(postsByUrl.at(-1)?.keys).toHaveLength(1);
    expect(postsByUrl.at(-1)?.keys[0]?.ownerUserId).toBe(carol.id);
    expect(postsByUrl.at(-1)?.keys[0]?.version).toBe(2);
    expect(new Set(storedKeys.map((key) => key.version))).toEqual(
      new Set([1, 2])
    );

    // And Carol can read everything, both sides of the gap.
    const view = snapshot(roster);
    expect(await readMessage(carol, view, healed.message, alice.id)).toEqual({
      content: "after the heal",
      type: "text",
    });
  });

  test("a rotation refused as a lost race sends under the winner's epoch", async () => {
    // The route refuses a batch that would complete or contradict an epoch
    // somebody else owns. That refusal used to reach the user as "Message not
    // sent" while the message itself was perfectly sendable under the root the
    // other member already published.
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob];
    await send(alice, snapshot(roster), 0, "epoch one");

    // Carol arrives, which forces a rotation. Bob wins it while Alice's batch is
    // in flight, so Alice's batch is refused.
    carol.createdAt = tick();
    roster = [alice, bob, carol];
    refuseNextPost = async () => {
      // Bob's own fan-out, at the same version Alice was aiming for, committed
      // while her batch was in flight. Real wraps, so the loser resolving this
      // epoch means resolving it rather than reading a fixture.
      const winnerRoot = generateRootKey();
      const fanOut = await wrapRootKeyForMembers(
        bob.pair.privateKey,
        roster.map((member) => ({
          publicKeyBase64: member.publicKeyBase64,
          userId: member.id,
        })),
        DEN_ID,
        winnerRoot
      );
      storeBatch(
        DEN_ID,
        fanOut.wrapped.map((wrap) => ({
          encryptedKey: wrap.encryptedKey,
          ownerUserId: wrap.userId,
          version: 2,
          wrapperPublicKey: bob.publicKeyBase64,
          wrapperUserId: bob.id,
        }))
      );
    };

    const aliceSend = await send(
      alice,
      snapshot(roster),
      1,
      "alice rotates",
      () => snapshot(roster)
    );
    const view = snapshot(roster);

    // Exactly one root under version 2, and it is Bob's.
    expect(storedKeys.filter((key) => key.version === 2)).toHaveLength(3);
    // Alice did not send under a root of her own that nobody holds: her message is
    // readable by the other two members, which is the only thing that distinguishes
    // "lost the race and caught up" from "encrypted under a key nobody has".
    expect(await readMessage(bob, view, aliceSend.message, alice.id)).toEqual({
      content: "alice rotates",
      type: "text",
    });
    expect(await readMessage(carol, view, aliceSend.message, alice.id)).toEqual(
      { content: "alice rotates", type: "text" }
    );
  });

  test("a stale snapshot is refetched before rotating, so no root is stranded", async () => {
    // The client guard that keeps the race above rare rather than constant: a
    // snapshot with no keys at all is refetched first, so the second sender finds
    // the first sender's epoch instead of minting a competing one.
    const [alice, bob] = await makeMembers(2);
    roster = [alice, bob];
    const first = await send(alice, snapshot(roster), 0, "epoch one");
    const stale = snapshot(roster);
    stale.keys = [];

    const second = await send(bob, stale, 0, "bob replies", () =>
      snapshot(roster)
    );

    // One epoch, and Bob's message went into it rather than into a root of his own
    // that never reached the server.
    expect(new Set(storedKeys.map((key) => key.version))).toEqual(new Set([1]));
    expect(storedKeys).toHaveLength(2);
    expect(
      await readMessage(alice, snapshot(roster), second.message, bob.id)
    ).toEqual({
      content: "bob replies",
      type: "text",
    });
    expect(
      await readMessage(bob, snapshot(roster), first.message, alice.id)
    ).toEqual({
      content: "epoch one",
      type: "text",
    });
  });

  test("an epoch is never overwritten, only appended", async () => {
    const [alice, bob] = await makeMembers(2);
    roster = [alice, bob];
    await send(alice, snapshot(roster), 0, "one");
    const afterFirst = storedKeys.map((key) => ({ ...key }));

    // Send again with a refreshed snapshot: same epoch, nothing to write.
    await send(bob, snapshot(roster), 0, "two");
    await send(alice, snapshot(roster), 1, "three");

    // The original rows are byte-identical: nothing was rewritten in place.
    for (const [index, original] of afterFirst.entries()) {
      const current = storedKeys[index];
      expect(current?.encryptedKey).toBe(original.encryptedKey);
      expect(current?.iv).toBe(original.iv);
      expect(current?.wrapperUserId).toBe(original.wrapperUserId);
    }
    // One version, one row per member, for the whole run.
    expect(new Set(storedKeys.map((key) => key.version))).toEqual(new Set([1]));
    expect(storedKeys).toHaveLength(2);
  });

  test("a wrapper who reset their identity does not strand the epoch they made", async () => {
    // Bob wrapped epoch 2 for everybody. Then Bob reset: the roster publishes a
    // new key for them, and the wrap is an ECDH pairing with the key that no longer
    // exists. Resolving the row through the live identity would drop it — and
    // because that row is the pairing for every member's copy of epoch 2, dropping
    // it would cost the whole den the epoch, Bob's own messages included. The row's
    // own snapshot is the pairing, so it is what a reader has to use.
    const [alice, bob, carol] = await makeMembers(3);
    roster = [alice, bob, carol];
    await send(alice, snapshot(roster), 0, "epoch one");
    // Bob rotates epoch 2, so every row names him as the wrapper. Written by the
    // harness rather than by a send, so the state under test is the same whichever
    // way the pairing is resolved.
    const bobEpoch = await writeEpoch({
      members: roster,
      rotator: bob,
      version: 2,
      writtenAt: tick(),
    });
    const bobSend = await writeMessage(
      bobEpoch,
      bob.id,
      DEN_ID,
      0,
      "bob's epoch"
    );
    expect(
      storedKeys.filter(
        (key) => key.version === 2 && key.wrapperUserId === bob.id
      )
    ).toHaveLength(3);

    // Bob resets. Same account, new keypair, and the roster now publishes it.
    const resetBob = await resetIdentity(bob);
    roster = [alice, resetBob, carol];
    const view = snapshot(roster);

    // The members who were there keep the epoch Bob wrapped for them, because the
    // row names the pairing rather than whoever Bob's identity happens to be now.
    const kept = await Promise.all(
      [alice, carol].map(
        async (member) => await readMessage(member, view, bobSend, bob.id)
      )
    );
    for (const read of kept) {
      expect(read).toEqual({ content: "bob's epoch", type: "text" });
    }
    // Bob's own reset copy cannot unwrap a pairing against the key it deleted —
    // nothing could, that is what a reset means — so the send path mints the next
    // epoch for him and the den carries on.
    const backIn = await send(resetBob, view, 0, "bob is back");
    const withBobBack = snapshot(roster);
    expect(Math.max(...storedKeys.map((key) => key.version))).toBeGreaterThan(
      2
    );
    expect(
      await readMessage(resetBob, withBobBack, backIn.message, resetBob.id)
    ).toEqual({ content: "bob is back", type: "text" });
    const caughtUp = await Promise.all(
      [alice, carol].map(
        async (member) =>
          await readMessage(member, withBobBack, backIn.message, resetBob.id)
      )
    );
    for (const read of caughtUp) {
      expect(read).toEqual({ content: "bob is back", type: "text" });
    }
  });

  test("a member who cannot be wrapped for is skipped without stranding the epoch", async () => {
    const [alice, bob, silent] = await makeMembers(3);
    roster = [alice, bob, silent];
    const reported: string[][] = [];

    const rootKey = await ensureConversationKeys(
      snapshot(roster, { withoutIdentity: silent.id }),
      alice.pair.privateKey,
      alice.id,
      { onUnwrappableMembers: (userIds) => reported.push(userIds) }
    );

    // The rotation went through for everybody who can read, rather than being
    // refused over a member who never enabled messages.
    expect(rootKey).not.toBeNull();
    expect(reported).toEqual([[silent.id]]);
    expect(storedKeys.map((key) => key.ownerUserId).toSorted()).toEqual(
      [alice.id, bob.id].toSorted()
    );
    // And the epoch is immediately usable by both of them.
    const message = await writeMessage(
      rootKey ?? generateRootKey(),
      alice.id,
      DEN_ID,
      0,
      "hello"
    );
    expect(await readMessage(bob, snapshot(roster), message, alice.id)).toEqual(
      { content: "hello", type: "text" }
    );
  });

  test("every member holds a wrap for the newest epoch, through joins and removals", async () => {
    // The invariant, stated over a roster that actually moves: a member joins, a
    // member leaves, a fan-out is interrupted, and a newcomer arrives. After every
    // send, every member on the roster whose identity is on file holds a wrap for
    // the newest epoch. A roster that never changed would not exercise a single
    // one of those paths.
    const members = await makeMembers(6);
    roster = members;
    const [alice, bob, carol, dave, erin, frank] = members;
    if (!alice || !bob || !carol || !dave || !erin || !frank) {
      throw new Error("expected six members");
    }

    const assertCovered = (label: string) => {
      const newest = Math.max(...storedKeys.map((key) => key.version));
      const uncovered = roster
        .filter(
          (member) =>
            !storedKeys.some(
              (key) => key.ownerUserId === member.id && key.version === newest
            )
        )
        .map((member) => member.id);
      expect({ label, newest, uncovered }).toEqual({
        label,
        newest,
        uncovered: [],
      });
    };

    // Six members, one epoch, and no fan-out paid per send.
    // oxlint-disable-next-line no-await-in-loop -- one send at a time, each checked against the state the previous one left
    await send(alice, snapshot(roster), 0, "epoch one");
    assertCovered("first send");

    // Erin leaves: the epoch she holds is contaminated, so it is left alone and a
    // new one covers the rest.
    roster = [alice, bob, carol, dave, frank];
    // oxlint-disable-next-line no-await-in-loop -- one send at a time, each checked against the state the previous one left
    await send(bob, snapshot(roster), 1, "after erin left");
    assertCovered("after a removal");

    // A new member arrives and a fan-out is interrupted for them in the same
    // breath: the rotation covers the roster, so the epoch is never partial.
    roster = [alice, bob, carol, dave, erin, frank];
    erin.createdAt = tick();
    // oxlint-disable-next-line no-await-in-loop -- one send at a time, each checked against the state the previous one left
    await send(alice, snapshot(roster), 2, "welcome back erin");
    assertCovered("after a rejoin");

    // Now interrupt the next fan-out: everybody keeps their older wrap, and the
    // heal fills the single gap at the epoch already in use.
    const beforeInterrupt = new Set(storedKeys.map((key) => key.version));
    const newestBeforeInterrupt = Math.max(
      ...storedKeys.map((key) => key.version)
    );
    forgetKeys(frank.id, newestBeforeInterrupt);
    // oxlint-disable-next-line no-await-in-loop -- one send at a time, each checked against the state the previous one left
    await send(carol, snapshot(roster), 3, "after the interrupted fan-out");
    assertCovered("after an interrupted fan-out");
    expect(new Set(storedKeys.map((key) => key.version))).toEqual(
      beforeInterrupt
    );
  });

  test("a full-size den sends without a fan-out after the epoch is complete", async () => {
    // The performance guard at full size. The epoch is minted once (100 ECDH
    // pairings, one batch), and every send after that is a single unwrap with no
    // writes at all, so the fan-out is paid per membership change and not per
    // message.
    const members = await makeMembers(DEN_LIMITS.membersMax);
    roster = members;
    const [rotator, departed] = members;
    if (!rotator || !departed) {
      throw new Error("expected a rotator");
    }
    const rootKey = await ensureConversationKeys(
      snapshot(roster),
      rotator.pair.privateKey,
      rotator.id
    );
    expect(storedKeys).toHaveLength(DEN_LIMITS.membersMax);

    const unwrapped = await Promise.all(
      members.map(
        async (member) =>
          await ensureConversationKeys(
            snapshot(roster),
            member.pair.privateKey,
            member.id
          )
      )
    );
    for (const root of unwrapped) {
      expect(
        Buffer.from(root ?? new Uint8Array()).equals(
          Buffer.from(rootKey ?? new Uint8Array())
        )
      ).toBe(true);
    }
    // One batch, one epoch, one write for the whole roster: no send paid a fan-out.
    expect(postsByUrl).toHaveLength(1);
    expect(new Set(storedKeys.map((key) => key.version))).toEqual(new Set([1]));

    // A message under epoch 1, to be the thing the newcomer must not be able to
    // read at the end of this.
    const tooEarly = await writeMessage(
      rootKey ?? generateRootKey(),
      rotator.id,
      DEN_ID,
      0,
      "before you got here"
    );

    // One member out and one in — the shape a real den sees — and the joiner is
    // in the very millisecond the next epoch is written, to keep the boundary
    // honest at full size.
    const joinedAt = tick();
    const newcomer = await makeMember("late-arrival", joinedAt);
    setClock(joinedAt);
    const nextRoster = [
      ...members.filter((member) => member.id !== departed.id),
      newcomer,
    ];
    const rotated = await ensureConversationKeys(
      snapshot(nextRoster),
      newcomer.pair.privateKey,
      newcomer.id
    );
    expect(rotated).not.toBeNull();
    expect(storedKeys.filter((key) => key.version === 2)).toHaveLength(
      DEN_LIMITS.membersMax
    );
    expect(
      storedKeys.filter(
        (key) => key.ownerUserId === newcomer.id && key.version === 1
      )
    ).toHaveLength(0);
    // The departed member holds neither of the new epoch's rows, and the cost of
    // the membership change is exactly one more batch.
    expect(
      storedKeys.filter(
        (key) => key.ownerUserId === departed.id && key.version === 2
      )
    ).toHaveLength(0);
    expect(postsByUrl).toHaveLength(2);

    // And the joiner reads nothing from before they arrived, while everybody who
    // was in the room still can.
    const view = snapshot(nextRoster);
    expect(await readMessage(newcomer, view, tooEarly, rotator.id)).toBeNull();
    expect(await readMessage(rotator, view, tooEarly, rotator.id)).toEqual({
      content: "before you got here",
      type: "text",
    });
    // A second send from the new roster costs nothing at all.
    // oxlint-disable-next-line no-await-in-loop -- one send at a time, each checked against the state the previous one left
    await send(rotator, snapshot(nextRoster), 1, "and on we go");
    expect(postsByUrl).toHaveLength(2);
    expect(Math.max(...storedKeys.map((key) => key.version))).toBe(2);
  });
});

describe("DM root-key epochs", () => {
  // A DM's two membership rows are written in the same transaction as the
  // conversation, so no message under any DM epoch predates the peer. That is what
  // keeps the whole epoch discipline a den-only concern: a peer holding no wrap at
  // all is a partial write to repair, never an arrival to lock out, so the DM path
  // still heals where a den rotates.
  const dm = (members: readonly Member[]) =>
    snapshot(members, { id: DM_ID, type: "DM" });

  test("heals a missing peer wrap instead of rotating a DM", async () => {
    const [alice, bob] = await makeMembers(2);
    roster = [alice, bob];
    const hello = await send(alice, dm(roster), 0, "hi bob");
    expect(storedKeys).toHaveLength(2);
    expect(postsByUrl).toHaveLength(1);

    // The peer's row never landed, which is what a legacy partial or an
    // interrupted write leaves behind.
    forgetKeys(bob.id);

    // Alice is the one who can read the epoch, so it is her send that repairs it.
    const reply = await send(alice, dm(roster), 1, "hi again");
    // A heal at the epoch already in use: a second epoch would have cost the pair
    // their history on every partial write.
    expect(postsByUrl).toHaveLength(2);
    expect(postsByUrl.at(-1)?.keys.map((key) => key.version)).toEqual([1]);
    expect(postsByUrl.at(-1)?.keys.map((key) => key.ownerUserId)).toEqual([
      bob.id,
    ]);
    expect(storedKeys).toHaveLength(2);
    expect(new Set(storedKeys.map((key) => key.version))).toEqual(new Set([1]));
    // Both sides read both messages, so the pair is intact.
    const view = dm(roster);
    expect(await readMessage(bob, view, hello.message, alice.id)).toEqual({
      content: "hi bob",
      type: "text",
    });
    expect(await readMessage(bob, view, reply.message, alice.id)).toEqual({
      content: "hi again",
      type: "text",
    });
  });

  test("rotates after an identity reset so both sides keep reading", async () => {
    const [alice, bob] = await makeMembers(2);
    roster = [alice, bob];
    const first = await send(alice, dm(roster), 0, "epoch one");

    // Alice reset: the roster publishes a new key for her, so nothing unwraps and
    // the pair moves to a new epoch rather than sending under a root she cannot
    // read. The peer keeps her pre-reset history, which is the whole reason the
    // old epochs are never deleted.
    const resetAlice = await resetIdentity(alice);
    roster = [resetAlice, bob];
    const rotated = await send(resetAlice, dm(roster), 1, "epoch two");
    expect(storedKeys.filter((key) => key.version === 2)).toHaveLength(2);

    const view = dm(roster);
    expect(await readMessage(bob, view, rotated.message, alice.id)).toEqual({
      content: "epoch two",
      type: "text",
    });
    // The pre-reset history is still readable by the peer, on the old epoch.
    expect(await readMessage(bob, view, first.message, alice.id)).toEqual({
      content: "epoch one",
      type: "text",
    });
    // And the reset sender reads her own new message, which is the one that would
    // be stranded if the rotation had wrapped for a superseded key.
    expect(
      await readMessage(resetAlice, view, rotated.message, alice.id)
    ).toEqual({
      content: "epoch two",
      type: "text",
    });
  });
});
