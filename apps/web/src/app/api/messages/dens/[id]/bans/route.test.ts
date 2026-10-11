import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenBannedMember, DenError as DenErrorClass } from "@asm/db";
import { normalizeDenBanReason as realNormalizeDenBanReason } from "@asm/db";

import {
  DEN_BAN_RATE_LIMIT,
  DEN_BANS_LIST_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET, POST } from "./route";

// The ban collection: reading it and writing to it. Manager-only in both directions,
// because a ban is a decision about a person made by somebody else, and the reason is
// read and normalized here rather than trusted from the client's textarea.
//
// What this cannot prove is the part that matters most, which is that a ban actually
// stops a join. `den-bans.integration.test.ts` proves that against a real database.

class DenError extends Error {
  code: DenErrorClass["code"];
  constructor(code: DenErrorClass["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DenError";
  }
}

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "admin" } }));

const mockListDenBans = mock(
  (_conversationId: string, _actorId: string): Promise<DenBannedMember[]> =>
    Promise.resolve([])
);
const mockBanDenMember = mock(
  (
    _conversationId: string,
    _actorId: string,
    _targetUserId: string,
    _options?: { reason?: string }
  ) => Promise.resolve()
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

const chargedBuckets: string[] = [];
const mockConsumeDenRateLimit = mock((rule: { bucket: string }) => {
  chargedBuckets.push(rule.bucket);
  return Promise.resolve(null);
});
mock.module("@/lib/messages/den-rate-limit", () =>
  denRateLimitDouble(mockConsumeDenRateLimit)
);

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  DenError,
  banDenMember: mockBanDenMember,
  listDenBans: mockListDenBans,
  // The REAL one, deliberately. `bans/route.ts` calls it OUTSIDE its try block, so a
  // missing binding is a TypeError that escapes `POST` altogether rather than becoming
  // a 500, and `den-bans.ts` pulls in `prisma` - which this barrel replaces.
  //
  // It did not need listing here, because a module reached by a static import keeps the
  // bindings it resolved before the mock was hoisted over it. That is import-order luck,
  // not a guarantee, and the two tests below are asserting a trim and a cap that this
  // function performs. Reachable from `@asm/db/messages/dens`, which is a different
  // specifier and is not replaced.
  normalizeDenBanReason: realNormalizeDenBanReason,
}));

const SIGNED_IN: Session = { user: { id: "admin" } };

function list(id = "den-1", session: Session = SIGNED_IN) {
  mockGetSession.mockReturnValue(session);
  return GET(
    new Request(`http://localhost:3000/api/messages/dens/${id}/bans`),
    { params: Promise.resolve({ id }) }
  );
}

function ban(body: unknown, id = "den-1", session: Session = SIGNED_IN) {
  mockGetSession.mockReturnValue(session);
  return POST(
    new Request(`http://localhost:3000/api/messages/dens/${id}/bans`, {
      body: typeof body === "string" ? body : JSON.stringify(body),
      method: "POST",
    }),
    { params: Promise.resolve({ id }) }
  );
}

describe("GET /api/messages/dens/:id/bans", () => {
  beforeEach(() => {
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockConsumeDenRateLimit.mockImplementation((rule) => {
      chargedBuckets.push(rule.bucket);
      return Promise.resolve(null);
    });
    mockGetSession.mockClear();
    mockListDenBans.mockClear();
    mockListDenBans.mockImplementation(() => Promise.resolve([]));
  });

  test("requires auth", async () => {
    const res = await list("den-1", null);
    expect(res.status).toBe(401);
    expect(mockListDenBans).not.toHaveBeenCalled();
  });

  test("returns the list as the service built it", async () => {
    const bans = [
      {
        bannedById: "admin",
        bannedByName: "admin",
        conversationId: "den-1",
        createdAt: new Date(0),
        displayName: "Ada",
        reason: "spam",
        userId: "user-2",
        username: "ada",
      },
    ];
    mockListDenBans.mockImplementationOnce(() => Promise.resolve(bans));

    const res = await list();

    expect(res.status).toBe(200);
    expect(mockListDenBans).toHaveBeenCalledWith("den-1", "admin");
    // The envelope is `{bans}` rather than a bare array so a future page or count can
    // be added without changing the shape the client already parses.
    const listed = (await res.json()) as { bans: unknown[] };
    expect(listed.bans).toHaveLength(1);
  });

  test("spends its own read budget, not the ban budget", async () => {
    await list();
    expect(chargedBuckets).toEqual([DEN_BANS_LIST_RATE_LIMIT.bucket]);
    expect(DEN_BANS_LIST_RATE_LIMIT.bucket).not.toBe(DEN_BAN_RATE_LIMIT.bucket);
  });

  test("429s without reading anything when the limiter denies", async () => {
    mockConsumeDenRateLimit.mockReturnValueOnce(
      Promise.resolve(Response.json({ error: "slow down" }, { status: 429 }))
    );
    const res = await list();
    expect(res.status).toBe(429);
    expect(mockListDenBans).not.toHaveBeenCalled();
  });

  // The list is the only read of who has been banned, so a plain member reaching it
  // would be seeing the moderation record of people who are not in the room.
  test("403s for somebody who is not a manager", async () => {
    mockListDenBans.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "Managers only")
    );
    const res = await list();
    expect(res.status).toBe(403);
  });

  test("500s on a failure that is not a domain outcome", async () => {
    mockListDenBans.mockRejectedValueOnce(new Error("boom"));
    const res = await list();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/messages/dens/:id/bans", () => {
  beforeEach(() => {
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockConsumeDenRateLimit.mockImplementation((rule) => {
      chargedBuckets.push(rule.bucket);
      return Promise.resolve(null);
    });
    mockGetSession.mockClear();
    mockBanDenMember.mockClear();
    mockBanDenMember.mockImplementation(() => Promise.resolve());
  });

  test("requires auth", async () => {
    const res = await ban({ userId: "user-2" }, "den-1", null);
    expect(res.status).toBe(401);
    expect(mockBanDenMember).not.toHaveBeenCalled();
  });

  test("bans the named person", async () => {
    const res = await ban({ userId: "user-2" });
    // 201 rather than 200: the ban row is a resource that now exists and can be read
    // back off the collection, which is exactly what 201 is for.
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockBanDenMember).toHaveBeenCalledWith("den-1", "admin", "user-2", {
      reason: null,
    });
  });

  test("400s without a target rather than banning somebody", async () => {
    const res = await ban({});
    expect(res.status).toBe(400);
    expect(mockBanDenMember).not.toHaveBeenCalled();
  });

  test("400s on a reason that is not a string", async () => {
    // Coerced rather than refused, `reason: 7` would store the string "7" and read back
    // in the banned list as though somebody had typed it.
    const res = await ban({ reason: 7, userId: "user-2" });
    expect(res.status).toBe(400);
    expect(mockBanDenMember).not.toHaveBeenCalled();
  });

  test("spends the ban budget", async () => {
    await ban({ userId: "user-2" });
    expect(chargedBuckets).toEqual([DEN_BAN_RATE_LIMIT.bucket]);
  });

  test("429s without banning anybody when the limiter denies", async () => {
    mockConsumeDenRateLimit.mockReturnValueOnce(
      Promise.resolve(Response.json({ error: "slow down" }, { status: 429 }))
    );
    const res = await ban({ userId: "user-2" });
    expect(res.status).toBe(429);
    expect(mockBanDenMember).not.toHaveBeenCalled();
  });

  // The reason is a note left for the next manager in a list that may be read months
  // later, so it is trimmed and capped here rather than trusted to the caller's
  // textarea. What the route sends is already normalized, which is what lets the
  // service store it without re-deciding.
  test("trims and caps the reason", async () => {
    await ban({ reason: "  spam  ", userId: "user-2" });
    expect(mockBanDenMember).toHaveBeenCalledWith("den-1", "admin", "user-2", {
      reason: "spam",
    });

    mockBanDenMember.mockClear();
    await ban({ reason: "x".repeat(400), userId: "user-2" });
    const options = mockBanDenMember.mock.calls[0]?.[3] as { reason?: string };
    expect(options.reason?.length).toBeLessThanOrEqual(140);
  });

  test("treats a blank reason as no reason", async () => {
    await ban({ reason: "   ", userId: "user-2" });
    expect(mockBanDenMember).toHaveBeenCalledWith("den-1", "admin", "user-2", {
      reason: null,
    });
  });

  test("409s on self-ban, which has to go through leave", async () => {
    mockBanDenMember.mockRejectedValueOnce(
      new DenError("SELF_ACTION", "Use leave to remove yourself")
    );
    const res = await ban({ userId: "admin" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "SELF_ACTION",
      error: "Use leave to remove yourself",
    });
  });

  test("403s when a manager aims at the owner", async () => {
    mockBanDenMember.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "The owner cannot be banned")
    );
    const res = await ban({ userId: "owner" });
    expect(res.status).toBe(403);
  });

  test("404s when the target was never in this den", async () => {
    mockBanDenMember.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "That person has never been a member")
    );
    const res = await ban({ userId: "stranger" });
    expect(res.status).toBe(404);
  });

  test("500s on a failure that is not a domain outcome", async () => {
    mockBanDenMember.mockRejectedValueOnce(new Error("boom"));
    const res = await ban({ userId: "user-2" });
    expect(res.status).toBe(500);
  });
});
