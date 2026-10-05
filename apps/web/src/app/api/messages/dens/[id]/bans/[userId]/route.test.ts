import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import {
  DEN_BAN_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { DELETE } from "./route";

// Lifting a ban. The target arrives in the URL rather than the body, so this route owns
// that the path segment is read the same way removal reads its own - and that the
// authority to do it is checked here rather than assumed from the fact that the reader
// can see the list.

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
const mockUnbanDenMember = mock(
  (_conversationId: string, _actorId: string, _targetUserId: string) =>
    Promise.resolve()
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
  unbanDenMember: mockUnbanDenMember,
}));

const SIGNED_IN: Session = { user: { id: "admin" } };

function unban(id = "den-1", userId = "user-2", session: Session = SIGNED_IN) {
  mockGetSession.mockReturnValue(session);
  return DELETE(
    new Request(
      `http://localhost:3000/api/messages/dens/${id}/bans/${userId}`,
      { method: "DELETE" }
    ),
    { params: Promise.resolve({ id, userId }) }
  );
}

describe("DELETE /api/messages/dens/:id/bans/:userId", () => {
  beforeEach(() => {
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockConsumeDenRateLimit.mockImplementation((rule) => {
      chargedBuckets.push(rule.bucket);
      return Promise.resolve(null);
    });
    mockGetSession.mockClear();
    mockUnbanDenMember.mockClear();
    mockUnbanDenMember.mockImplementation(() => Promise.resolve());
  });

  test("requires auth", async () => {
    const res = await unban("den-1", "user-2", null);
    expect(res.status).toBe(401);
    expect(mockUnbanDenMember).not.toHaveBeenCalled();
  });

  test("lifts the ban named in the path", async () => {
    const res = await unban("den-1", "user-2");
    // 204: a lift has no representation to return. The client learns it worked from
    // the empty body and re-reads the collection, which is now missing the row.
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(mockUnbanDenMember).toHaveBeenCalledWith("den-1", "admin", "user-2");
  });

  // A lift shares the ban bucket rather than getting one of its own: both are the
  // manager acting on the list, a manager flipping a decision back and forth is the
  // same thing as one imposing it repeatedly, and two buckets would let it be half as
  // fast without being half as rate limited.
  test("spends the ban budget, the same one the ban does", async () => {
    await unban();
    expect(chargedBuckets).toEqual([DEN_BAN_RATE_LIMIT.bucket]);
  });

  test("429s without lifting when the limiter denies", async () => {
    mockConsumeDenRateLimit.mockReturnValueOnce(
      Promise.resolve(Response.json({ error: "slow down" }, { status: 429 }))
    );
    const res = await unban();
    expect(res.status).toBe(429);
    expect(mockUnbanDenMember).not.toHaveBeenCalled();
  });

  test("403s for somebody who is not a manager", async () => {
    mockUnbanDenMember.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "Managers only")
    );
    const res = await unban();
    expect(res.status).toBe(403);
  });

  test("404s on a den that does not exist", async () => {
    mockUnbanDenMember.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "No such den")
    );
    const res = await unban();
    expect(res.status).toBe(404);
  });

  test("500s on a failure that is not a domain outcome", async () => {
    mockUnbanDenMember.mockRejectedValueOnce(new Error("boom"));
    const res = await unban();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Couldn't complete that, try again?",
    });
  });
});
