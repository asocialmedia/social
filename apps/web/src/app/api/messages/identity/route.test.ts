import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DELETE, GET, POST } from "./route";

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

// Reset path: the route issues both deletes in one $transaction array.
const mockIdentityDeleteMany = mock(() => ({ count: 1 }));
const mockKeysDeleteMany = mock(() => ({ count: 2 }));
const mockTransaction = mock((ops: unknown[]) => Promise.all(ops));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    messageConversationKey: { deleteMany: mockKeysDeleteMany },
    messageIdentity: {
      create: mockCreate,
      deleteMany: mockIdentityDeleteMany,
      findUnique: mockFindUnique,
    },
  },
}));

describe("GET /api/messages/identity", () => {
  beforeEach(() => {
    mockFindUnique.mockClear();
    mockCreate.mockClear();
    mockGetSession.mockClear();
  });

  test("returns null identity when none exists", async () => {
    const res = await GET();
    const body = (await res.json()) as {
      identity: null;
    };
    expect(body.identity).toBeNull();
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
    const body = (await res.json()) as { identity: null };
    expect(body.identity).toBeNull();
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
    };
    expect(body.identity.publicKey).toBe("pub");
    expect(body.identity.kdfIterations).toBe(600_000);
    expect(body.identity.masterKeyHash).toBe("hash");
    expect(body.identity.updatedAt).toBe("2026-01-02T00:00:00.000Z");
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
      data: { masterKeyHash: string; publicKey: string; userId: string };
    };
    expect(args.data.userId).toBe("user1");
    expect(args.data.publicKey).toBe("pub-key");
    expect(args.data.masterKeyHash).toBe(validBody.masterKeyHash);
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

describe("DELETE /api/messages/identity", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockIdentityDeleteMany.mockClear();
    mockKeysDeleteMany.mockClear();
    mockTransaction.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockIdentityDeleteMany.mockReturnValue({ count: 1 });
    mockKeysDeleteMany.mockReturnValue({ count: 2 });
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
    const identityArgs = mockIdentityDeleteMany.mock.calls[0]?.[0] as {
      where: { userId: string };
    };
    // Self-scoped: the owner filter means no other account's identity can be
    // touched by this endpoint.
    expect(identityArgs.where).toEqual({ userId: "user1" });
  });

  test("deletes only the caller's own key wraps, leaving the peer's intact", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removedKeys: 2 });
    const keysArgs = mockKeysDeleteMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    // Scoped by owner only. Any conversation-wide filter would delete the
    // peer's wraps and destroy their history, which the reset must never do.
    expect(keysArgs.where).toEqual({ ownerUserId: "user1" });
    expect(keysArgs.where).not.toHaveProperty("conversationId");
  });
});
