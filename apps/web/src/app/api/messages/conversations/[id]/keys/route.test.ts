import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

// The keys write path owns three decisions that only matter once a conversation
// can have more than two members:
//
//   - the wrapper columns, because a den reader has to know whose public key each
//     wrap was paired with;
//   - one conversation-wide version ceiling, so every member's wrap for a version
//     denotes the same root;
//   - an all-or-nothing batch, so an epoch is either fanned out to everybody it
//     names or it does not exist. Half an epoch is not a smaller win: a message
//     encrypted under it is unreadable for the members missing a wrap.
//
// The orm is mocked rather than real, so what is under test is the route's own
// arithmetic and ordering — the same rules the real query enforces with its
// unique index are simulated here by the fake table below.

interface StoredRow {
  conversationId: string;
  encryptedKey: string;
  iv: string;
  ownerUserId: string;
  version: number;
  wrapperPublicKey: string | null;
  wrapperUserId: string | null;
}

const CONVERSATION_ID = "den-keys";
const MEMBER_IDS = ["owner", "admin", "member"];

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: MEMBER_IDS[0] } }));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

const mockGetConversationForUser = mock((id: string, userId: string) =>
  Promise.resolve(
    id === CONVERSATION_ID && MEMBER_IDS.includes(userId)
      ? {
          id: CONVERSATION_ID,
          members: MEMBER_IDS.map((memberId) => ({ userId: memberId })),
          type: "DEN",
        }
      : null
  )
);
mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockGetConversationForUser,
  isUniqueConstraintViolation: (error: unknown) =>
    (error as { code?: string } | null)?.code === "23505",
  parseJsonBody: (body: Request) => body.json(),
}));

let rows: StoredRow[] = [];
// Set to make the next insert fail the way a concurrent rotation would: the row
// this call is trying to write already landed.
let conflictOnInsert: { ownerUserId: string; version: number } | null = null;
// Commits rows the way a racing writer's transaction would: outside this call's
// transaction, so a rollback here cannot take them back, and visible to whatever
// the route reads next.
function commitConcurrently(committed: StoredRow[]) {
  rows = [...rows, ...committed.map((row) => ({ ...row }))];
}
// Committed partway through this call's batch, so a test can put a racing
// writer's whole epoch on file at a chosen insert and make a later row collide
// with it.
let commitAfterInserts: { count: number; rows: StoredRow[] } | null = null;
// Runs between the route's version-ceiling read and its (owner, version) pairs
// read, so a test can make those two reads disagree the way two separate
// snapshots really do.
let betweenTheTwoReads: (() => void) | null = null;
// What the transaction did, so the test can tell a committed batch from a rollback.
let transactionCommits = 0;
let transactionRollbacks = 0;

const published: { conversationId: string; userId: string }[] = [];
// The rows this transaction wrote and has to give back if it unwinds.
let uncommittedRows: StoredRow[] = [];

// The handle the route's transaction callback receives: just enough of the orm to
// insert a key row.
interface FakeTransaction {
  orm: {
    public: {
      MessageConversationKeys: {
        create: (row: StoredRow) => Promise<void>;
      };
    };
  };
}

// Stands in for the database's transaction: a batch that throws leaves the table
// exactly as it was, apart from anything another writer committed in the
// meantime, which is the property that makes a partially covered epoch impossible.
async function runTransaction<T>(
  operation: (tx: FakeTransaction) => Promise<T>,
  tx: FakeTransaction
): Promise<T> {
  try {
    const value = await operation(tx);
    transactionCommits += 1;
    uncommittedRows = [];
    return value;
  } catch (error) {
    transactionRollbacks += 1;
    // Only this transaction's own writes are undone. Rows that landed from
    // elsewhere while it was open stay, because the database never held a lock
    // that would have rolled them back with it.
    rows = rows.filter((row) => !uncommittedRows.includes(row));
    uncommittedRows = [];
    throw error;
  }
}

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        MessageConversationKeys: {
          select: (...fields: string[]) => {
            // Two shapes are read: the single highest version, and every
            // (owner, version) pair on file.
            const highestOnly = fields.length === 1 && fields[0] === "version";
            const pairsOnly =
              fields.length === 2 &&
              fields[0] === "ownerUserId" &&
              fields[1] === "version";
            const builder = {
              all: () => {
                if (pairsOnly && betweenTheTwoReads) {
                  betweenTheTwoReads();
                  betweenTheTwoReads = null;
                }
                return Promise.resolve(rows.map((row) => ({ ...row })));
              },
              first: () => {
                let highest = 0;
                for (const row of rows) {
                  highest = Math.max(highest, row.version);
                }
                return Promise.resolve(
                  highestOnly ? { version: highest } : null
                );
              },
              orderBy: () => builder,
              where: () => builder,
            };
            return builder;
          },
        },
      },
    },
    transaction: mock(
      (operation: (tx: FakeTransaction) => Promise<unknown>) => {
        let insertsSoFar = 0;
        const tx = {
          orm: {
            public: {
              MessageConversationKeys: {
                create: (row: StoredRow) => {
                  // The unique index is on (conversation, owner, version), so a
                  // duplicate is refused whether this transaction wrote it or a
                  // racing one did.
                  const collides = rows.some(
                    (onFile) =>
                      onFile.ownerUserId === row.ownerUserId &&
                      onFile.version === row.version
                  );
                  const forced =
                    conflictOnInsert &&
                    conflictOnInsert.ownerUserId === row.ownerUserId &&
                    conflictOnInsert.version === row.version;
                  if (collides || forced) {
                    return Promise.reject(
                      Object.assign(new Error("duplicate key"), {
                        code: "23505",
                      })
                    );
                  }
                  rows.push({ ...row });
                  uncommittedRows.push(rows.at(-1) ?? row);
                  insertsSoFar += 1;
                  if (
                    commitAfterInserts &&
                    insertsSoFar === commitAfterInserts.count
                  ) {
                    commitConcurrently(commitAfterInserts.rows);
                  }
                  return Promise.resolve();
                },
              },
            },
          },
        };
        // The commit/rollback bookkeeping is the database's, not the route's: a
        // batch that throws leaves its own rows exactly as they were.
        return runTransaction(operation, tx);
      }
    ),
  },
  publishMessageKeysRotated: mock((conversationId: string, userId: string) => {
    published.push({ conversationId, userId });
    return Promise.resolve();
  }),
}));

function request(body: unknown): Request {
  return new Request(
    `http://localhost/api/messages/conversations/${CONVERSATION_ID}/keys`,
    {
      body: JSON.stringify(body),
      method: "POST",
    }
  );
}

function wrapFor(ownerUserId: string, version: number) {
  return {
    encryptedKey: { ciphertext: `cipher-${ownerUserId}-${version}`, iv: "iv" },
    ownerUserId,
    version,
  };
}

function storedKeyFor(ownerUserId: string, version: number): StoredRow {
  return {
    conversationId: CONVERSATION_ID,
    encryptedKey: `cipher-${ownerUserId}-${version}`,
    iv: "iv",
    ownerUserId,
    version,
    wrapperPublicKey: "owner-pub",
    wrapperUserId: "owner",
  };
}

async function post(body: unknown) {
  return await POST(request(body), {
    params: Promise.resolve({ id: CONVERSATION_ID }),
  });
}

beforeEach(() => {
  rows = [];
  conflictOnInsert = null;
  commitAfterInserts = null;
  betweenTheTwoReads = null;
  uncommittedRows = [];
  transactionCommits = 0;
  transactionRollbacks = 0;
  published.length = 0;
  mockGetSession.mockClear();
});

describe("POST conversation keys", () => {
  test("fans one epoch out to every member in a single write", async () => {
    const response = await post({
      keys: [
        {
          ...wrapFor("owner", 1),
          wrapperPublicKey: "owner-pub",
          wrapperUserId: "owner",
        },
        {
          ...wrapFor("admin", 1),
          wrapperPublicKey: "owner-pub",
          wrapperUserId: "owner",
        },
        {
          ...wrapFor("member", 1),
          wrapperPublicKey: "owner-pub",
          wrapperUserId: "owner",
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 3, ok: true });
    // Every row, same epoch, same wrapper, one transaction.
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.version))).toEqual(new Set([1]));
    for (const row of rows) {
      expect(row.wrapperUserId).toBe("owner");
      expect(row.wrapperPublicKey).toBe("owner-pub");
    }
    expect(transactionCommits).toBe(1);
    expect(transactionRollbacks).toBe(0);
  });

  test("stores the wrapper columns so a reader can resolve the pairing", async () => {
    await post({
      keys: [
        {
          ...wrapFor("member", 1),
          wrapperPublicKey: "rotator-pub",
          wrapperUserId: "owner",
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      wrapperPublicKey: "rotator-pub",
      wrapperUserId: "owner",
    });
  });

  test("a DM-style row with no wrapper is stored as null", async () => {
    // The legacy shape: no wrapper named, so the reader pairs it with the peer.
    const response = await post({ keys: [wrapFor("member", 1)] });
    expect(response.status).toBe(200);
    expect(rows[0]?.wrapperUserId).toBeNull();
    expect(rows[0]?.wrapperPublicKey).toBeNull();
  });

  test("refuses a wrap owned by somebody who is not a member", async () => {
    const response = await post({ keys: [wrapFor("stranger", 1)] });
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  test("refuses a wrapper that is not the caller", async () => {
    // Only the holder of the private key a blob was paired with can have made it,
    // so a member cannot file a row claiming somebody else did.
    const response = await post({
      keys: [
        {
          ...wrapFor("member", 1),
          wrapperPublicKey: "admin-pub",
          wrapperUserId: "admin",
        },
      ],
    });
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  test("refuses an empty blob rather than storing an unwrappable wrap", async () => {
    const response = await post({
      keys: [
        {
          encryptedKey: { ciphertext: "", iv: "iv" },
          ownerUserId: "member",
          version: 1,
        },
      ],
    });
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  test("rejects a version above the conversation-wide ceiling", async () => {
    await post({ keys: [wrapFor("owner", 1), wrapFor("admin", 1)] });
    const response = await post({
      keys: [wrapFor("member", 9), wrapFor("owner", 9)],
    });
    expect(response.status).toBe(409);
    expect(rows).toHaveLength(2);
  });

  test("accepts a heal for an already-seen version", async () => {
    // The one partial epoch that MUST be completable: a version at or below the
    // ceiling is being finished, not minted, and finishing it is the whole heal
    // path. The whole-batch rule for a version above the ceiling does not apply
    // here, and this test is where that distinction is pinned.
    await post({ keys: [wrapFor("owner", 1), wrapFor("admin", 1)] });
    const response = await post({ keys: [wrapFor("member", 1)] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 1, ok: true });
    expect(rows).toHaveLength(3);
  });

  test("an exact retry is a no-op that reports storing nothing", async () => {
    const body = {
      keys: [
        { ...wrapFor("owner", 1), wrapperUserId: "owner" },
        { ...wrapFor("admin", 1), wrapperUserId: "owner" },
      ],
    };
    await post(body);
    const retry = await post(body);
    // applied: 0 is what tells a client that its rotation lost the race for the
    // epoch, rather than letting it encrypt under a root nobody stored.
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ applied: 0, ok: true });
    expect(rows).toHaveLength(2);
  });

  test("a row is never overwritten", async () => {
    const first = await post({ keys: [wrapFor("owner", 1)] });
    expect(first.status).toBe(200);
    // Same (owner, version), different ciphertext: refused by create-only
    // semantics rather than replacing what the holder already unwraps with.
    const second = await post({
      keys: [
        {
          encryptedKey: { ciphertext: "tampered", iv: "iv" },
          ownerUserId: "owner",
          version: 1,
        },
      ],
    });
    expect(second.status).toBe(200);
    expect(rows[0]?.encryptedKey).toBe("cipher-owner-1");
  });

  test("a partially claimed epoch is refused, not completed by a second writer", async () => {
    // The concurrent-rotation case. Epoch 1 exists, so version 2 is the ceiling. The
    // pre-read of (owner, version) pairs sees no epoch-2 rows, so both are pending,
    // and the second insert collides with a writer that landed it in between. The
    // transaction rolls back whole and the caller is told to refetch, because a
    // partially covered epoch is worse than none.
    rows = [
      {
        conversationId: CONVERSATION_ID,
        encryptedKey: "cipher-owner-1",
        iv: "iv",
        ownerUserId: "owner",
        version: 1,
        wrapperPublicKey: "owner-pub",
        wrapperUserId: "owner",
      },
    ];
    conflictOnInsert = { ownerUserId: "admin", version: 2 };
    const response = await post({
      keys: [
        { ...wrapFor("owner", 2), wrapperUserId: "owner" },
        { ...wrapFor("admin", 2), wrapperUserId: "owner" },
      ],
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Another rotation claimed this epoch",
    });
    // Nothing of the losing batch survives: no half epoch on file. The epoch that
    // was already there is untouched, because a refusal writes nothing at all.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
    expect(transactionRollbacks).toBe(1);
    expect(transactionCommits).toBe(0);
  });

  test("a lost race that another writer fully covered is accepted as a no-op", async () => {
    // The other half of the race: every row this batch names is already on file, so
    // there is no partial epoch to refuse, only a redundant root key. Accepting it
    // keeps a retry idempotent, and `applied: 0` is how the caller learns it lost.
    await post({
      keys: [
        { ...wrapFor("owner", 1), wrapperUserId: "owner" },
        { ...wrapFor("admin", 1), wrapperUserId: "owner" },
        { ...wrapFor("member", 1), wrapperUserId: "owner" },
      ],
    });
    // Admin races the owner with the same target version, so its whole batch is
    // already on file.
    mockGetSession.mockImplementationOnce(() => ({ user: { id: "admin" } }));
    const loser = await post({
      keys: [
        { ...wrapFor("owner", 1), wrapperUserId: "admin" },
        { ...wrapFor("admin", 1), wrapperUserId: "admin" },
        { ...wrapFor("member", 1), wrapperUserId: "admin" },
      ],
    });
    expect(loser.status).toBe(200);
    expect(await loser.json()).toEqual({ applied: 0, ok: true });
    // The winner's wraps are untouched.
    expect(rows.every((row) => row.wrapperUserId === "owner")).toBe(true);
  });

  test("a rolled-back batch reports storing nothing, not what it wrote before it unwound", async () => {
    // The counter is incremented inside the transaction, so a batch that unwinds
    // has to take the count with it. Reporting the rolled-back count would tell a
    // rotation it had won an epoch whose root key nobody holds — the sender
    // included — and the client would encrypt its next message under a key that
    // exists nowhere.
    //
    // The shape is forced rather than hoped for. This batch writes its first row,
    // the racing writer's whole epoch lands as the collision is raised, and the
    // second row is the one that collides. Coverage then passes, so the route does
    // accept the call, and the only thing that can be wrong is what it reports.
    rows = [storedKeyFor("owner", 1)];
    commitAfterInserts = {
      count: 1,
      rows: [storedKeyFor("owner", 2), storedKeyFor("admin", 2)],
    };

    const response = await post({
      keys: [
        { ...wrapFor("owner", 2), wrapperUserId: "owner" },
        { ...wrapFor("admin", 2), wrapperUserId: "owner" },
      ],
    });

    expect(transactionRollbacks).toBe(1);
    expect(response.status).toBe(200);
    // Every pair this call asked for is on file, so accepting is right — but this
    // call stored none of them.
    expect(await response.json()).toEqual({ applied: 0, ok: true });
    expect(rows.filter((row) => row.version === 2)).toHaveLength(2);
    expect(rows.every((row) => row.wrapperUserId === "owner")).toBe(true);
  });

  test("a new version already on file is refused rather than completed", async () => {
    // The race the pre-read cannot see coming. The ceiling read says the newest
    // version is 1, so version 2 is legal to create; then a racing rotation commits
    // its own epoch 2 before the pairs read, and the pairs read reduces this batch
    // to the one member the winner missed. Writing those would put a second root
    // key under version 2 — and because the ceiling is max+1 and version 2 now
    // exists, nothing can ever repair it.
    rows = [storedKeyFor("owner", 1)];
    betweenTheTwoReads = () => {
      commitConcurrently([storedKeyFor("owner", 2), storedKeyFor("admin", 2)]);
    };

    const response = await post({
      keys: [
        { ...wrapFor("owner", 2), wrapperUserId: "owner" },
        { ...wrapFor("admin", 2), wrapperUserId: "owner" },
        { ...wrapFor("member", 2), wrapperUserId: "owner" },
      ],
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Another rotation claimed this epoch",
    });
    // Not one row of this call's version: the epoch is the winner's, whole.
    expect(
      rows.filter((row) => row.ownerUserId === "member" && row.version === 2)
    ).toHaveLength(0);
    expect(rows.filter((row) => row.version === 2)).toHaveLength(2);
    // A refusal writes nothing at all, so nothing is announced either.
    expect(transactionCommits).toBe(0);
    expect(published).toEqual([]);
  });

  test("announces the rotation to the other members' open threads", async () => {
    await post({ keys: [wrapFor("owner", 1)] });
    expect(published).toEqual([
      { conversationId: CONVERSATION_ID, userId: "owner" },
    ]);
  });

  test("refuses an empty batch", async () => {
    const response = await post({ keys: [] });
    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  test("refuses a conversation the caller is not a member of", async () => {
    mockGetSession.mockImplementationOnce(() => ({
      user: { id: "stranger" },
    }));
    const response = await post({ keys: [wrapFor("owner", 1)] });
    expect(response.status).toBe(404);
    expect(rows).toHaveLength(0);
  });
});
