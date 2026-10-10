import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import {
  DEN_ROLES_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

// Ownership is the one piece of den state that must have exactly one writer, so
// this route is deliberately strict about what it will accept: OWNER is not
// assignable, and a body that does not name both a role and a target is
// refused here rather than after a round trip.

class DenError extends Error {
  code: DenErrorClass["code"];
  constructor(code: DenErrorClass["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DenError";
  }
}

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "owner" } }));
const mockSetDenMemberRole = mock(
  (
    _conversationId: string,
    _actorId: string,
    _targetUserId: string,
    _role: string
  ) => Promise.resolve()
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

// Which bucket each call was handed, so a test can say WHICH budget an operation
// spends rather than only that a limiter was consulted.
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
  setDenMemberRole: mockSetDenMemberRole,
}));

const OWNER: Session = { user: { id: "owner" } };

function setRole(body: unknown, session: Session = OWNER) {
  mockGetSession.mockReturnValue(session);
  return POST(
    new Request("http://localhost:3000/api/messages/dens/den-1/role", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: "den-1" }) }
  );
}

describe("POST /api/messages/dens/:id/role", () => {
  beforeEach(() => {
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockConsumeDenRateLimit.mockImplementation((rule) => {
      chargedBuckets.push(rule.bucket);
      return Promise.resolve(null);
    });
    mockGetSession.mockClear();
    mockSetDenMemberRole.mockClear();
    mockSetDenMemberRole.mockImplementation(() => Promise.resolve());
  });

  test("requires auth", async () => {
    const res = await setRole({ role: "ADMIN", userId: "user-2" }, null);
    expect(res.status).toBe(401);
    expect(mockSetDenMemberRole).not.toHaveBeenCalled();
  });

  test("rejects a role that is neither ADMIN nor MEMBER", async () => {
    // OWNER included: ownership moves by leaving or dissolving, so a body that
    // asks to mint an owner is the one request that must never reach the service.
    for (const role of ["OWNER", "owner", "admin", "MODERATOR", 1, null]) {
      // oxlint-disable-next-line no-await-in-loop -- one assertion per shape, sequential on purpose
      const res = await setRole({ role, userId: "user-2" });
      expect(res.status).toBe(400);
    }
    expect(mockSetDenMemberRole).not.toHaveBeenCalled();
  });

  test("rejects a missing or empty userId", async () => {
    for (const body of [
      { role: "ADMIN" },
      { role: "ADMIN", userId: "" },
      { role: "ADMIN", userId: 7 },
      { role: "MEMBER", userId: null },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one assertion per shape, sequential on purpose
      const res = await setRole(body);
      expect(res.status).toBe(400);
    }
    expect(mockSetDenMemberRole).not.toHaveBeenCalled();
  });

  test("rejects a body that is not an object at all", async () => {
    const res = await setRole("ADMIN");
    expect(res.status).toBe(400);
    expect(mockSetDenMemberRole).not.toHaveBeenCalled();
  });

  test("promotes a member", async () => {
    const res = await setRole({ role: "ADMIN", userId: "user-2" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: "ADMIN" });
    expect(mockSetDenMemberRole).toHaveBeenCalledWith(
      "den-1",
      "owner",
      "user-2",
      "ADMIN"
    );
  });

  test("demotes a member", async () => {
    const res = await setRole({ role: "MEMBER", userId: "user-2" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: "MEMBER" });
    expect(mockSetDenMemberRole).toHaveBeenCalledWith(
      "den-1",
      "owner",
      "user-2",
      "MEMBER"
    );
  });

  test("spends the roles budget, which a rename cannot exhaust", async () => {
    const res = await setRole({ role: "ADMIN", userId: "user-2" });
    expect(res.status).toBe(200);
    expect(chargedBuckets).toEqual([DEN_ROLES_RATE_LIMIT.bucket]);
  });

  test("answers 429 without changing a role when the limiter denies", async () => {
    mockConsumeDenRateLimit.mockReturnValueOnce(
      Promise.resolve(Response.json({ error: "slow down" }, { status: 429 }))
    );
    const res = await setRole({ role: "ADMIN", userId: "user-2" });
    expect(res.status).toBe(429);
    expect(mockSetDenMemberRole).not.toHaveBeenCalled();
  });

  test("validates the body before spending the rate limit budget", async () => {
    await setRole({ role: "OWNER", userId: "user-2" });
    expect(mockConsumeDenRateLimit).not.toHaveBeenCalled();
  });

  test("403s when somebody who is not the owner tries to promote", async () => {
    mockSetDenMemberRole.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "Only the owner can do that")
    );
    const res = await setRole(
      { role: "ADMIN", userId: "user-2" },
      { user: { id: "admin" } }
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "FORBIDDEN",
      error: "Only the owner can do that",
    });
  });

  test("409s when the caller tries to change their own role", async () => {
    mockSetDenMemberRole.mockRejectedValueOnce(
      new DenError("SELF_ACTION", "You cannot change your own role")
    );
    const res = await setRole({ role: "MEMBER", userId: "owner" });
    expect(res.status).toBe(409);
  });

  test("404s when the target is not a member of this den", async () => {
    mockSetDenMemberRole.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "That person is not a member")
    );
    const res = await setRole({ role: "ADMIN", userId: "stranger" });
    expect(res.status).toBe(404);
  });
});
