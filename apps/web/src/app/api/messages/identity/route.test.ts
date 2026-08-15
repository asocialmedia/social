import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET, POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));

const mockFindUnique = mock(() => null);
const mockUpsert = mock(() => ({}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  prisma: {
    messageIdentity: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  },
}));

describe("GET /api/messages/identity", () => {
  beforeEach(() => {
    mockFindUnique.mockClear();
    mockUpsert.mockClear();
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
    expect(mockUpsert).not.toHaveBeenCalled();
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
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("upserts a valid identity backup", async () => {
    const body = {
      encryptedPrivateKey: "enc-enc",
      kdfIterations: 600_000,
      masterKeyHash:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const args = mockUpsert.mock.calls[0]?.[0] as {
      create: { masterKeyHash: string; userId: string };
      where: { userId: string };
    };
    expect(args.create.userId).toBe("user1");
    expect(args.create.masterKeyHash).toBe(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    expect(args.where.userId).toBe("user1");
  });
});
