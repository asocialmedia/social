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
const mockFindFirst = mock(() =>
  maxVersion > 0 ? { version: maxVersion } : null
);
const mockCreateMany = mock(() => ({ count: 1 }));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockGetConversation,
  parseJsonBody: (request: Request) => request.json(),
}));

mock.module("@asm/db", () => ({
  prisma: {
    messageConversationKey: {
      createMany: mockCreateMany,
      findFirst: mockFindFirst,
    },
  },
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
    mockCreateMany.mockClear();
    mockFindFirst.mockClear();
    mockGetSession.mockClear();
    mockGetConversation.mockClear();
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
    const args = mockCreateMany.mock.calls[0]?.[0] as {
      data: { version: number }[];
    };
    expect(args.data[0]?.version).toBe(1);
  });

  test("accepts the next epoch when one already exists", async () => {
    maxVersion = 1;
    const res = await post(keyBody(2));
    expect(res.status).toBe(200);
    const args = mockCreateMany.mock.calls[0]?.[0] as {
      data: { version: number }[];
    };
    expect(args.data[0]?.version).toBe(2);
  });

  test("rejects a version that jumps past the next epoch", async () => {
    maxVersion = 1;
    const res = await post(keyBody(5));
    expect(res.status).toBe(409);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  test("rejects a non-integer or non-positive version", async () => {
    maxVersion = 1;
    const zero = await post(keyBody(0));
    const fractional = await post(keyBody(1.5));
    expect(zero.status).toBe(409);
    expect(fractional.status).toBe(409);
    expect(mockCreateMany).not.toHaveBeenCalled();
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
    expect(mockCreateMany).not.toHaveBeenCalled();
  });
});
