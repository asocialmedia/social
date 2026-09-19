import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET, DELETE } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockFindUnique = mock(() => null);
const mockCredentialDeleteMany = mock(() => ({ count: 1 }));
const mockIdentityUpdateMany = mock(() => ({ count: 1 }));
const mockTransaction = mock((ops: unknown[]) => Promise.all(ops));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    messageIdentity: { updateMany: mockIdentityUpdateMany },
    messageRecoveryCredential: {
      deleteMany: mockCredentialDeleteMany,
      findUnique: mockFindUnique,
    },
  },
}));

describe("GET /api/messages/recovery", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockFindUnique.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockFindUnique.mockReturnValue(null);
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("reports no credential when none is enrolled", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ credential: null });
  });

  test("scopes the lookup to the signed-in user", async () => {
    mockFindUnique.mockReturnValueOnce({
      createdAt: new Date("2026-01-01T00:00:00Z"),
      credentialId: "cred-1",
    } as never);
    const res = await GET();
    expect(await res.json()).toEqual({
      credential: {
        createdAt: "2026-01-01T00:00:00.000Z",
        credentialId: "cred-1",
      },
    });
    const args = mockFindUnique.mock.calls[0]?.[0] as {
      where: { userId: string };
    };
    expect(args.where).toEqual({ userId: "user1" });
  });
});

describe("DELETE /api/messages/recovery", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockCredentialDeleteMany.mockClear();
    mockIdentityUpdateMany.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(mockCredentialDeleteMany).not.toHaveBeenCalled();
  });

  test("removes only the caller's credential and resets their backup method", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mockCredentialDeleteMany.mock.calls[0]?.[0]).toEqual({
      where: { userId: "user1" },
    });
    // The PRF backup copy is intentionally retained (harmless ciphertext, and
    // re-enrolling the same credential can still read it); only the method hint
    // is cleared.
    expect(mockIdentityUpdateMany.mock.calls[0]?.[0]).toEqual({
      data: { backupMethod: "manual-secret" },
      where: { userId: "user1" },
    });
  });
});
