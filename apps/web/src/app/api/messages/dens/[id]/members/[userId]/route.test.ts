import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import {
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { DELETE } from "./route";

// Removal is the one mutation whose target arrives in the URL rather than the
// body, so what this route owns is that the path segment and the session are
// read the same way, and that self-removal never reaches the service as a kick.

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
const mockRemoveDenMember = mock(
  (_conversationId: string, _actorId: string, _targetUserId: string) =>
    Promise.resolve()
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
  removeDenMember: mockRemoveDenMember,
}));

// A named constant rather than an object literal, so it can be a default
// argument without tripping the no-object-as-default-parameter rule.
const SIGNED_IN: Session = { user: { id: "admin" } };

function remove(id = "den-1", userId = "user-2", session: Session = SIGNED_IN) {
  mockGetSession.mockReturnValue(session);
  return DELETE(
    new Request(
      `http://localhost:3000/api/messages/dens/${id}/members/${userId}`,
      { method: "DELETE" }
    ),
    { params: Promise.resolve({ id, userId }) }
  );
}

describe("DELETE /api/messages/dens/:id/members/:userId", () => {
  beforeEach(() => {
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockConsumeDenRateLimit.mockImplementation((rule) => {
      chargedBuckets.push(rule.bucket);
      return Promise.resolve(null);
    });
    mockGetSession.mockClear();
    mockRemoveDenMember.mockClear();
    mockRemoveDenMember.mockImplementation(() => Promise.resolve());
  });

  test("requires auth", async () => {
    const res = await remove("den-1", "user-2", null);
    expect(res.status).toBe(401);
    expect(mockRemoveDenMember).not.toHaveBeenCalled();
  });

  test("removes the member named in the path", async () => {
    const res = await remove("den-1", "user-2");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockRemoveDenMember).toHaveBeenCalledWith(
      "den-1",
      "admin",
      "user-2"
    );
  });

  test("spends the remove-member budget, which nothing else does", async () => {
    const res = await remove("den-1", "user-2");
    expect(res.status).toBe(200);
    expect(chargedBuckets).toEqual([DEN_REMOVE_MEMBER_RATE_LIMIT.bucket]);
  });

  test("answers 429 without removing anybody when the limiter denies", async () => {
    mockConsumeDenRateLimit.mockReturnValueOnce(
      Promise.resolve(Response.json({ error: "slow down" }, { status: 429 }))
    );
    const res = await remove();
    expect(res.status).toBe(429);
    expect(mockRemoveDenMember).not.toHaveBeenCalled();
  });

  test("409s on self-removal, which has to go through leave", async () => {
    // A plain delete here would skip the ownership transfer that leaving the den
    // carries, so the service refuses and the client is told to use the other
    // door rather than being silently given a kick.
    mockRemoveDenMember.mockRejectedValueOnce(
      new DenError("SELF_ACTION", "Use leave to remove yourself")
    );
    const res = await remove("den-1", "admin");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "SELF_ACTION",
      error: "Use leave to remove yourself",
    });
  });

  test("403s when a manager aims at the owner", async () => {
    mockRemoveDenMember.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "The owner cannot be removed")
    );
    const res = await remove("den-1", "owner");
    expect(res.status).toBe(403);
  });

  test("404s when the target is not a member of this den", async () => {
    mockRemoveDenMember.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "That person is not a member")
    );
    const res = await remove("den-1", "stranger");
    expect(res.status).toBe(404);
  });

  test("500s on a failure that is not a domain outcome", async () => {
    mockRemoveDenMember.mockRejectedValueOnce(new Error("boom"));
    const res = await remove();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Couldn't complete that, try again?",
    });
  });
});
