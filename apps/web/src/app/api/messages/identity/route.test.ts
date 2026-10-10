import { beforeEach, describe, expect, mock, test } from "bun:test";

import type {
  MessageIdentityBackupRefreshInput,
  MessageIdentityBackupRefreshResult,
} from "@asm/db";

import { DEN_MESSAGE_IDENTITY_REFRESH_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { DELETE, GET, PATCH, POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));

type IdentityRow = {
  createdAt: Date;
  encryptedPrivateKey: string;
  kdfIterations: number;
  masterKeyHash: string | null;
  publicKey: string;
  salt: string;
  updatedAt: Date;
  userId: string;
} | null;
const mockFindUnique = mock((): IdentityRow | Promise<IdentityRow> => null);
const mockCreate = mock(() => ({}));
const mockCommitIdentityBackupRefresh = mock(
  (
    _input: MessageIdentityBackupRefreshInput
  ): Promise<MessageIdentityBackupRefreshResult> =>
    Promise.resolve({
      recoveryGeneration: 6,
      repairConversationIds: ["conversation-1"],
      status: "updated",
    })
);
const mockEnqueueSearchBackfill = mock(
  (_conversationId: string, _cursorKey: string | null) => Promise.resolve()
);

// Reset path: the route runs both deletes inside one transaction callback.
// Recorded so the tests can assert each delete stayed self-scoped.
const mockIdentityDelete = mock(() => ({}));
const mockKeysDeleteAndCount = mock(() => 2);
const mockSearchStateFind = mock(() => ({ recoveryGeneration: 5 }));
const mockSearchStateRead = mock(() => ({ recoveryGeneration: 5 }));
const mockSearchStateUpsert = mock(() => ({}));
let identityWhere: Record<string, unknown> | null = null;
let keysWhere: Record<string, unknown> | null = null;
let searchStateWhere: Record<string, unknown> | null = null;
let searchStateUpsertInput: Record<string, unknown> | null = null;
let denyIdentityRefreshLimit = false;
const mockConsumeRateLimit = mock(
  (options: {
    bucket: string;
    identifier: string;
    limit: number;
    windowSeconds: number;
  }) => {
    const allowed =
      !denyIdentityRefreshLimit ||
      options.bucket !== DEN_MESSAGE_IDENTITY_REFRESH_RATE_LIMIT.bucket;
    return Promise.resolve({
      allowed,
      remaining: allowed ? options.limit - 1 : 0,
      resetAt: Date.now() + options.windowSeconds * 1000,
      retryAfterSeconds: 42,
    });
  }
);
const mockTransaction = mock((fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    orm: {
      public: {
        MessageConversationKeys: {
          where: (where: Record<string, unknown>) => {
            keysWhere = where;
            return { deleteAndCount: mockKeysDeleteAndCount };
          },
        },
        MessageIdentities: {
          where: (where: Record<string, unknown>) => {
            identityWhere = where;
            return { delete: mockIdentityDelete };
          },
        },
        MessageSearchAccountState: {
          where: (where: Record<string, unknown>) => {
            searchStateWhere = where;
            return {
              first: mockSearchStateFind,
              upsert: (input: Record<string, unknown>) => {
                searchStateUpsertInput = input;
                return mockSearchStateUpsert();
              },
            };
          },
        },
      },
    },
  })
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  commitMessageIdentityBackupRefresh: mockCommitIdentityBackupRefresh,
  consumeRateLimit: mockConsumeRateLimit,
  consumeRateLimitSliding: mockConsumeRateLimit,
  enqueueMessageSearchBackfill: mockEnqueueSearchBackfill,
  prisma: {
    orm: {
      public: {
        MessageIdentities: {
          create: mockCreate,
          select: () => ({ where: () => ({ first: mockFindUnique }) }),
          where: () => ({ first: mockFindUnique }),
        },
        MessageSearchAccountState: {
          select: () => ({
            where: () => ({ first: mockSearchStateRead }),
          }),
        },
      },
    },
    transaction: mockTransaction,
  },
}));

describe("GET /api/messages/identity", () => {
  beforeEach(() => {
    mockFindUnique.mockClear();
    mockSearchStateRead.mockReset();
    mockSearchStateRead.mockReturnValue({ recoveryGeneration: 5 });
    mockCreate.mockClear();
    mockGetSession.mockClear();
  });

  test("returns null identity when none exists", async () => {
    const res = await GET();
    const body = (await res.json()) as {
      identity: null;
      recoveryGeneration: number;
    };
    expect(body.identity).toBeNull();
    expect(body.recoveryGeneration).toBe(5);
  });

  test("treats a legacy identity without a backup-secret hash as absent", async () => {
    mockFindUnique.mockReturnValueOnce({
      createdAt: new Date("2026-01-01T00:00:00Z"),
      encryptedPrivateKey: "enc",
      kdfIterations: 600_000,
      masterKeyHash: null,
      publicKey: "pub",
      salt: "salt",
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      userId: "user1",
    });
    const res = await GET();
    const body = (await res.json()) as {
      identity: null;
      recoveryGeneration: number;
    };
    expect(body.identity).toBeNull();
    expect(body.recoveryGeneration).toBe(5);
  });

  test("returns the stored identity", async () => {
    mockFindUnique.mockReturnValueOnce({
      createdAt: new Date("2026-01-01T00:00:00Z"),
      encryptedPrivateKey: "enc",
      kdfIterations: 600_000,
      masterKeyHash: "hash",
      publicKey: "pub",
      salt: "salt",
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      userId: "user1",
    });
    const res = await GET();
    const body = (await res.json()) as {
      identity: {
        kdfIterations: number;
        masterKeyHash: string;
        publicKey: string;
        updatedAt: string;
      };
      recoveryGeneration: number;
    };
    expect(body.identity.publicKey).toBe("pub");
    expect(body.identity.kdfIterations).toBe(600_000);
    expect(body.identity.masterKeyHash).toBe("hash");
    expect(body.identity.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(body.recoveryGeneration).toBe(5);
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("POST /api/messages/identity", () => {
  const validBody = {
    encryptedPrivateKey: "enc-enc",
    kdfIterations: 600_000,
    masterKeyHash:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    publicKey: "pub-key",
    salt: "salty",
  };

  beforeEach(() => {
    mockFindUnique.mockClear();
    mockCreate.mockClear();
    mockGetSession.mockClear();
    mockFindUnique.mockReturnValue(null);
  });

  test("rejects malformed payloads", async () => {
    mockGetSession.mockReturnValueOnce({ user: { id: "user1" } });
    const res = await POST(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify({ publicKey: "pub" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("rejects payloads without a backup-secret hash", async () => {
    const body = {
      encryptedPrivateKey: "enc-enc",
      kdfIterations: 600_000,
      publicKey: "pub-key",
      salt: "salty",
    };
    const res = await POST(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("creates the identity backup when none exists", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0]?.[0] as {
      masterKeyHash: string;
      publicKey: string;
      userId: string;
    };
    expect(args.userId).toBe("user1");
    expect(args.publicKey).toBe("pub-key");
    expect(args.masterKeyHash).toBe(validBody.masterKeyHash);
  });

  test("refuses to replace an existing identity", async () => {
    // Create-only: an existing row owns its keypair, and replacing it would
    // orphan every conversation key wrapped for the old one. Re-keying is the
    // explicit DELETE reset path.
    mockFindUnique.mockReturnValueOnce({
      publicKey: "pub-key",
    } as never);
    const res = await POST(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("returns 409 when a concurrent create loses the primary-key race", async () => {
    // Two tabs can pass the create-only pre-check at once; the loser hits the
    // primary key and must map to the same conflict as the pre-check.
    mockCreate.mockImplementationOnce(() => {
      throw Object.assign(new Error("unique constraint"), { code: "P2002" });
    });
    const res = await POST(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(409);
  });

  test("refuses to replace an existing identity with a different public key", async () => {
    mockFindUnique.mockReturnValueOnce({
      publicKey: "a-different-key",
    } as never);
    const res = await POST(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/messages/identity", () => {
  const expectedUpdatedAt = "2026-01-02T00:00:00.000Z";
  const validBody = {
    encryptedPrivateKey: "new-iv.new-ciphertext",
    expectedUpdatedAt,
    kdfIterations: 100_000,
    masterKeyHash:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    publicKey: "pub-key",
    salt: "new-salt",
  };

  beforeEach(() => {
    denyIdentityRefreshLimit = false;
    mockConsumeRateLimit.mockClear();
    mockGetSession.mockReset();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockCommitIdentityBackupRefresh.mockReset();
    mockCommitIdentityBackupRefresh.mockReturnValue({
      recoveryGeneration: 6,
      repairConversationIds: ["conversation-1"],
      status: "updated",
    });
    mockEnqueueSearchBackfill.mockReset();
    mockEnqueueSearchBackfill.mockImplementation(() => Promise.resolve());
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const response = await PATCH(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    );
    expect(response.status).toBe(401);
    expect(mockCommitIdentityBackupRefresh).not.toHaveBeenCalled();
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });

  test("charges the account refresh budget and honors a retryable refusal", async () => {
    denyIdentityRefreshLimit = true;
    const response = await PATCH(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: DEN_MESSAGE_IDENTITY_REFRESH_RATE_LIMIT.bucket,
        identifier: "user1",
      })
    );
    expect(mockCommitIdentityBackupRefresh).not.toHaveBeenCalled();
  });

  test("validates refresh fields before updating the row", async () => {
    const response = await PATCH(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify({ ...validBody, expectedUpdatedAt: "invalid" }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    );
    expect(response.status).toBe(400);
    expect(mockCommitIdentityBackupRefresh).not.toHaveBeenCalled();
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: DEN_MESSAGE_IDENTITY_REFRESH_RATE_LIMIT.bucket,
        identifier: "user1",
      })
    );
  });

  test("rejects oversized request bodies before updating the identity", async () => {
    const response = await PATCH(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify({
          ...validBody,
          encryptedPrivateKey: "x".repeat(130 * 1024),
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    );
    expect(response.status).toBe(413);
    expect(mockCommitIdentityBackupRefresh).not.toHaveBeenCalled();
  });

  test("updates the matching identity and durably restarts unreadable history", async () => {
    const response = await PATCH(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    );
    expect(response.status).toBe(200);
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: DEN_MESSAGE_IDENTITY_REFRESH_RATE_LIMIT.bucket,
        identifier: "user1",
      })
    );
    expect(mockCommitIdentityBackupRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedUpdatedAt: new Date(expectedUpdatedAt),
        publicKey: "pub-key",
        userId: "user1",
      })
    );
    const input = mockCommitIdentityBackupRefresh.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      encryptedPrivateKey: validBody.encryptedPrivateKey,
      kdfIterations: validBody.kdfIterations,
      masterKeyHash: validBody.masterKeyHash,
      salt: validBody.salt,
    });
    const updatedAt = input?.nextUpdatedAt;
    expect(updatedAt).toBeInstanceOf(Date);
    if (!(updatedAt instanceof Date)) {
      throw new Error("The identity revision timestamp must be a Date");
    }
    expect(updatedAt.getTime()).toBeGreaterThan(
      new Date(expectedUpdatedAt).getTime()
    );
    expect(await response.json()).toMatchObject({
      recoveryGeneration: 6,
      updatedAt: expect.any(String),
    });
    expect(mockEnqueueSearchBackfill).toHaveBeenCalledWith(
      "conversation-1",
      null
    );
  });

  test("returns a conflict when reset or another refresh wins the compare-and-swap", async () => {
    mockCommitIdentityBackupRefresh.mockReturnValueOnce({ status: "conflict" });
    const response = await PATCH(
      new Request("http://localhost:3000/api/messages/identity", {
        body: JSON.stringify(validBody),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.any(String),
    });
    expect(mockEnqueueSearchBackfill).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/messages/identity", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockIdentityDelete.mockClear();
    mockKeysDeleteAndCount.mockClear();
    mockSearchStateFind.mockReset();
    mockSearchStateFind.mockReturnValue({ recoveryGeneration: 5 });
    mockSearchStateUpsert.mockClear();
    mockTransaction.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockKeysDeleteAndCount.mockReturnValue(2);
    identityWhere = null;
    keysWhere = null;
    searchStateWhere = null;
    searchStateUpsertInput = null;
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("deletes only the caller's identity row", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mockIdentityDelete).toHaveBeenCalledTimes(1);
    // Self-scoped: the owner filter means no other account's identity can be
    // touched by this endpoint.
    expect(identityWhere).toEqual({ userId: "user1" });
  });

  test("deletes only the caller's own key wraps, leaving the peer's intact", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      recoveryGeneration: 6,
      removedKeys: 2,
    });
    // Scoped by owner only. Any conversation-wide filter would delete the
    // peer's wraps and destroy their history, which the reset must never do.
    expect(keysWhere).toEqual({ ownerUserId: "user1" });
    expect(keysWhere).not.toHaveProperty("conversationId");
  });

  test("increments the caller's recovery generation in the same reset transaction", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(searchStateWhere).toEqual({ userId: "user1" });
    expect(searchStateUpsertInput).toMatchObject({
      create: { recoveryGeneration: 6, userId: "user1" },
      update: { recoveryGeneration: 6 },
    });
  });
});
