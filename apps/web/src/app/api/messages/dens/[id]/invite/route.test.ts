import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import {
  DEN_MANAGE_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

// Rotation is the revocation step, so what matters here is narrow: the code the
// response hands back is the new one from the service, and the rotation is never
// announced for a caller the service refused.

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
const mockRotateInviteCode = mock((_conversationId: string, _actorId: string) =>
  Promise.resolve("fresh-code-000")
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

let limiterDenies = false;
// Which bucket each call was handed, so a test can say WHICH budget an operation
// spends rather than only that a limiter was consulted.
const chargedBuckets: string[] = [];
const mockConsumeDenRateLimit = mock((rule: { bucket: string }) => {
  chargedBuckets.push(rule.bucket);
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
  rotateInviteCode: mockRotateInviteCode,
}));

const SIGNED_IN: Session = { user: { id: "owner" } };

function rotate(session: Session = SIGNED_IN) {
  mockGetSession.mockReturnValue(session);
  return POST(
    new Request("http://localhost:3000/api/messages/dens/den-1/invite", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "den-1" }) }
  );
}

describe("POST /api/messages/dens/:id/invite", () => {
  beforeEach(() => {
    limiterDenies = false;
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockGetSession.mockClear();
    mockRotateInviteCode.mockClear();
    mockRotateInviteCode.mockImplementation(() =>
      Promise.resolve("fresh-code-000")
    );
  });

  test("requires auth", async () => {
    const res = await rotate(null);
    expect(res.status).toBe(401);
    expect(mockRotateInviteCode).not.toHaveBeenCalled();
  });

  test("returns the new code so the client can replace the shared link", async () => {
    const res = await rotate();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      inviteCode: "fresh-code-000",
      ok: true,
    });
    expect(mockRotateInviteCode).toHaveBeenCalledWith("den-1", "owner");
  });

  test("spends the manage budget, shared only with leaving", async () => {
    const res = await rotate();
    expect(res.status).toBe(200);
    expect(chargedBuckets).toEqual([DEN_MANAGE_RATE_LIMIT.bucket]);
  });

  test("answers 429 without retiring the old code when the limiter denies", async () => {
    // Failing open is the limiter's job, but when it does refuse, the current
    // code has to keep working: a 429 that also silently revoked the door would
    // lock everybody out of a den nobody removed them from.
    limiterDenies = true;
    const res = await rotate();
    expect(res.status).toBe(429);
    expect(mockRotateInviteCode).not.toHaveBeenCalled();
  });

  test("403s a plain member", async () => {
    mockRotateInviteCode.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "Only the owner or an elder can do that")
    );
    const res = await rotate({ user: { id: "member" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "FORBIDDEN",
      error: "Only the owner or an elder can do that",
    });
  });

  test("409s a DM rather than minting a code for a private thread", async () => {
    mockRotateInviteCode.mockRejectedValueOnce(
      new DenError("NOT_A_DEN", "That is not a den")
    );
    const res = await rotate();
    expect(res.status).toBe(409);
  });

  test("500s when the code could not be generated", async () => {
    mockRotateInviteCode.mockRejectedValueOnce(new Error("boom"));
    const res = await rotate();
    expect(res.status).toBe(500);
  });
});
