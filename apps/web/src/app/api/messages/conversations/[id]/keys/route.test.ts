import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockGetConversation = mock((conversationId: string, userId: string) =>
  conversationId === "convo-1" && userId === "user1"
    ? {
        id: "convo-1",
        members: [{ userId: "user1" }, { userId: "user2" }],
      }
    : null
);
// Highest version currently stored for the conversation (0 = none yet).
let maxVersion = 0;
let existingWraps: { ownerUserId: string; version: number }[] = [];
// Each successful create appends to existingWraps, so a retry of the same
// (owner, version) pair is a no-op the way the unique index makes it.
// Prisma 8 write terminals are thenable, so the mock returns a promise.
const mockCreate = mock((row: { ownerUserId: string; version: number }) => {
  existingWraps.push({ ownerUserId: row.ownerUserId, version: row.version });
  return row;
});
const mockPublishKeysRotated = mock(() => Promise.resolve());

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockGetConversation,
  isUniqueConstraintViolation: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505",
  parseJsonBody: (request: Request) => request.json(),
}));

mock.module("@asm/db", () => ({
  prisma: {
    orm: {
      public: {
        MessageConversationKeys: {
          create: mockCreate,
          select: () => {
            // The route reads the newest epoch (ordered, first) and the existing
            // (owner, version) pairs (unordered, all), so the chain carries both
            // terminals and stays chainable through where/orderBy.
            const read = {
              all: () => existingWraps,
              first: () => (maxVersion > 0 ? { version: maxVersion } : null),
              orderBy: () => read,
              where: () => read,
            };
            return read;
          },
          where: () => ({ all: () => existingWraps }),
        },
      },
    },
  },
  publishMessageKeysRotated: mockPublishKeysRotated,
}));

function keyBody(version?: number) {
  return {
    keys: [
      {
        encryptedKey: { ciphertext: "ct", iv: "iv" },
        ownerUserId: "user1",
        ...(version === undefined ? {} : { version }),
      },
    ],
  };
}

function post(body: unknown) {
  return POST(
    new Request(
      "http://localhost:3000/api/messages/conversations/convo-1/keys",
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    ),
    { params: Promise.resolve({ id: "convo-1" }) }
  );
}

describe("POST /api/messages/conversations/:id/keys", () => {
  beforeEach(() => {
    maxVersion = 0;
    existingWraps = [];
    mockCreate.mockClear();
    mockGetSession.mockClear();
    mockGetConversation.mockClear();
    mockPublishKeysRotated.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockGetConversation.mockImplementation(
      (conversationId: string, userId: string) =>
        conversationId === "convo-1" && userId === "user1"
          ? {
              id: "convo-1",
              members: [{ userId: "user1" }, { userId: "user2" }],
            }
          : null
    );
  });

  test("defaults a version-less legacy payload to epoch 1", async () => {
    const res = await post(keyBody());
    expect(res.status).toBe(200);
    const row = mockCreate.mock.calls[0]?.[0] as { version: number };
    expect(row.version).toBe(1);
  });

  test("accepts the next epoch when one already exists", async () => {
    maxVersion = 1;
    const res = await post(keyBody(2));
    expect(res.status).toBe(200);
    const row = mockCreate.mock.calls[0]?.[0] as { version: number };
    expect(row.version).toBe(2);
  });

  test("rejects a version that jumps past the next epoch", async () => {
    maxVersion = 1;
    const res = await post(keyBody(5));
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("rejects a non-integer or non-positive version", async () => {
    maxVersion = 1;
    const zero = await post(keyBody(0));
    const fractional = await post(keyBody(1.5));
    expect(zero.status).toBe(409);
    expect(fractional.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("rejects a key owned by a non-member", async () => {
    const res = await post({
      keys: [
        {
          encryptedKey: { ciphertext: "ct", iv: "iv" },
          ownerUserId: "stranger",
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("announces a rotation when new wraps are written", async () => {
    // The peer's open thread relies on this to refetch the detail; without it
    // their cached wraps go stale and every new message fails to decrypt.
    maxVersion = 1;
    const res = await post(keyBody(2));
    expect(res.status).toBe(200);
    expect(mockPublishKeysRotated).toHaveBeenCalledTimes(1);
    expect(mockPublishKeysRotated).toHaveBeenCalledWith("convo-1", "user1");
  });

  test("announces even when the write was an idempotent no-op", async () => {
    // A retry after a failed publish inserts nothing, because the wraps are
    // already there. Staying silent there loses the announcement the first
    // attempt already failed to deliver, and the peer only refetches its wraps
    // once per key signature, so a failed refetch leaves the thread unable to
    // decrypt until something else refreshes it. The duplicate announcement
    // costs the peer one refetch; a missed one costs them the conversation.
    maxVersion = 1;
    existingWraps = [{ ownerUserId: "user1", version: 2 }];
    const res = await post(keyBody(2));
    expect(res.status).toBe(200);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPublishKeysRotated).toHaveBeenCalledWith("convo-1", "user1");
  });
});
