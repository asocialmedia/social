import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import {
  DEN_INVITE_ROTATE_RATE_LIMIT,
  DEN_LEAVE_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import { denRateLimitDouble } from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { DELETE, POST } from "./route";

// Leaving and dissolving share a URL and nothing else. The route owns two
// decisions: that they are metered under different buckets, because dissolving
// is the one operation here that cannot be undone, and that the leave response
// tells the client what happened to the den, because its next move depends on
// whether there is anything left to navigate back to.

class DenError extends Error {
  code: DenErrorClass["code"];
  constructor(code: DenErrorClass["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DenError";
  }
}

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "member" } }));

let leaveResult = { dissolved: false, newOwnerId: null as string | null };
const mockLeaveDen = mock((_conversationId: string, _userId: string) =>
  Promise.resolve(leaveResult)
);
const mockDissolveDen = mock((_conversationId: string, _actorId: string) =>
  Promise.resolve()
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

const limitedRules: string[] = [];
let limiterDenies = false;
const mockConsumeDenRateLimit = mock((rule: { bucket: string }) => {
  limitedRules.push(rule.bucket);
  return Promise.resolve(
    limiterDenies
      ? Response.json({ error: "slow down" }, { status: 429 })
      : null
  );
});
mock.module("@/lib/messages/den-rate-limit", () =>
  denRateLimitDouble(mockConsumeDenRateLimit)
);

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  DenError,
  dissolveDen: mockDissolveDen,
  leaveDen: mockLeaveDen,
}));

// Named constants rather than object literals, so they can be default arguments
// without tripping the no-object-as-default-parameter rule.
const MEMBER: Session = { user: { id: "member" } };
const OWNER: Session = { user: { id: "owner" } };

function params(id = "den-1") {
  return { params: Promise.resolve({ id }) };
}

function leave(session: Session = MEMBER) {
  mockGetSession.mockReturnValue(session);
  return POST(
    new Request("http://localhost:3000/api/messages/dens/den-1/leave", {
      method: "POST",
    }),
    params()
  );
}

function dissolve(session: Session = OWNER) {
  mockGetSession.mockReturnValue(session);
  return DELETE(
    new Request("http://localhost:3000/api/messages/dens/den-1/leave", {
      method: "DELETE",
    }),
    params()
  );
}

describe("POST /api/messages/dens/:id/leave", () => {
  beforeEach(() => {
    leaveResult = { dissolved: false, newOwnerId: null };
    limitedRules.length = 0;
    limiterDenies = false;
    mockGetSession.mockClear();
    mockLeaveDen.mockClear();
    mockLeaveDen.mockImplementation(() => Promise.resolve(leaveResult));
  });

  test("requires auth", async () => {
    const res = await leave(null);
    expect(res.status).toBe(401);
    expect(mockLeaveDen).not.toHaveBeenCalled();
  });

  test("reports a plain leave with the den still open", async () => {
    const res = await leave();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dissolved: false,
      newOwnerId: null,
      ok: true,
    });
    expect(mockLeaveDen).toHaveBeenCalledWith("den-1", "member");
  });

  test("reports the successor when the owner hands the den over", async () => {
    leaveResult = { dissolved: false, newOwnerId: "user-2" };
    const res = await leave({ user: { id: "owner" } });
    expect(res.status).toBe(200);
    // The client navigates differently depending on this, and the successor is
    // only ever the caller's own so leaving discloses nothing about the roster.
    expect(await res.json()).toEqual({
      dissolved: false,
      newOwnerId: "user-2",
      ok: true,
    });
  });

  test("reports a dissolved den so the client has nowhere to go back to", async () => {
    leaveResult = { dissolved: true, newOwnerId: null };
    const res = await leave();
    expect(await res.json()).toEqual({
      dissolved: true,
      newOwnerId: null,
      ok: true,
    });
  });

  test("spends the leave budget on its own", async () => {
    // Rotation and leaving used to share `den-manage` and were bounded at 120 an
    // hour together. Split because their victims differ: a leave costs the
    // caller one row, a rotation breaks a shared link other people are walking
    // through, so a rotation loop could spend a leave's budget.
    await leave();
    expect(limitedRules).toEqual([DEN_LEAVE_RATE_LIMIT.bucket]);
    expect(DEN_LEAVE_RATE_LIMIT.limit).toBe(120);
    expect(DEN_LEAVE_RATE_LIMIT.windowSeconds).toBe(3600);
    expect(DEN_LEAVE_RATE_LIMIT.bucket).not.toBe(
      DEN_INVITE_ROTATE_RATE_LIMIT.bucket
    );
  });

  test("answers 429 without leaving when the limiter denies", async () => {
    limiterDenies = true;
    const res = await leave();
    expect(res.status).toBe(429);
    expect(mockLeaveDen).not.toHaveBeenCalled();
  });

  test("403s a non-member", async () => {
    mockLeaveDen.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "You are not a member of this den")
    );
    const res = await leave();
    expect(res.status).toBe(403);
  });

  test("404s a den that no longer exists", async () => {
    mockLeaveDen.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "Den not found")
    );
    const res = await leave();
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/messages/dens/:id/leave", () => {
  beforeEach(() => {
    limitedRules.length = 0;
    limiterDenies = false;
    mockDissolveDen.mockClear();
    mockDissolveDen.mockImplementation(() => Promise.resolve());
    mockGetSession.mockClear();
  });

  test("requires auth", async () => {
    const res = await dissolve(null);
    expect(res.status).toBe(401);
    expect(mockDissolveDen).not.toHaveBeenCalled();
  });

  test("dissolves the den", async () => {
    const res = await dissolve();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDissolveDen).toHaveBeenCalledWith("den-1", "owner");
  });

  test("is metered under its own bucket, separate from leave", async () => {
    // Dissolving takes the conversation, its messages and every wrap with it, so
    // it must not be spending the same budget a person walks out of a den on.
    await dissolve();
    expect(limitedRules).toEqual(["den-dissolve"]);
  });

  test("answers 429 without dissolving when the limiter denies", async () => {
    limiterDenies = true;
    const res = await dissolve();
    expect(res.status).toBe(429);
    expect(mockDissolveDen).not.toHaveBeenCalled();
  });

  test("403s an admin, since only the owner may dissolve", async () => {
    mockDissolveDen.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "Only the owner can do that")
    );
    const res = await dissolve({ user: { id: "admin" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "FORBIDDEN",
      error: "Only the owner can do that",
    });
  });

  test("409s a DM, which cannot be dissolved at all", async () => {
    mockDissolveDen.mockRejectedValueOnce(
      new DenError("NOT_A_DEN", "That is not a den")
    );
    const res = await dissolve();
    expect(res.status).toBe(409);
  });
});
