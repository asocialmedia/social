import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import {
  DEN_ROLES_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

// The hand-over route. Two halves are being tested and they fail differently: the
// body validation that must answer 400 before anything reaches the database, and
// the forwarding that must not turn a domain refusal into a 500.

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
const mockTransferDenOwnership = mock(
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
  transferDenOwnership: mockTransferDenOwnership,
}));

const OWNER: Session = { user: { id: "owner" } };

function transfer(body: unknown, session: Session = OWNER) {
  mockGetSession.mockReturnValue(session);
  return POST(
    new Request("http://localhost:3000/api/messages/dens/den-1/transfer", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: "den-1" }) }
  );
}

describe("POST /api/messages/dens/:id/transfer", () => {
  beforeEach(() => {
    mockConsumeDenRateLimit.mockClear();
    chargedBuckets.length = 0;
    mockConsumeDenRateLimit.mockImplementation((rule) => {
      chargedBuckets.push(rule.bucket);
      return Promise.resolve(null);
    });
    mockGetSession.mockClear();
    mockTransferDenOwnership.mockClear();
    mockTransferDenOwnership.mockImplementation(() => Promise.resolve());
  });

  test("requires auth", async () => {
    const res = await transfer({ userId: "user-2" }, null);
    expect(res.status).toBe(401);
    expect(mockTransferDenOwnership).not.toHaveBeenCalled();
  });

  test("rejects a body that is not an object at all", async () => {
    // `readJsonBody` answers null for malformed JSON and `objectOf` for an array
    // or a bare string, so both land on the same 400 rather than one of them
    // reaching the service with an undefined id.
    for (const body of ["user-2", "[]", "null", "42"]) {
      // oxlint-disable-next-line no-await-in-loop -- one assertion per shape, sequential on purpose
      const res = await transfer(body);
      expect(res.status).toBe(400);
    }
    expect(mockTransferDenOwnership).not.toHaveBeenCalled();
  });

  test("rejects a missing, empty or non-string userId", async () => {
    for (const body of [{}, { userId: "" }, { userId: 7 }, { userId: null }]) {
      // oxlint-disable-next-line no-await-in-loop -- one assertion per shape, sequential on purpose
      const res = await transfer(body);
      expect(res.status).toBe(400);
    }
    // One shape spelled out, so the message a person would read is asserted rather
    // than only the status.
    const missing = await transfer({ userId: "" });
    expect(await missing.json()).toEqual({ error: "userId is required" });
    expect(mockTransferDenOwnership).not.toHaveBeenCalled();
  });

  test("hands the den over", async () => {
    const res = await transfer({ userId: "user-2" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockTransferDenOwnership).toHaveBeenCalledWith(
      "den-1",
      "owner",
      "user-2"
    );
  });

  test("validates the body before spending the rate limit budget", async () => {
    // A crafted body costs nothing but a JSON parse, so it must not cost a slot
    // in a budget the owner might need for a real hand-over.
    await transfer({ userId: "" });
    expect(mockConsumeDenRateLimit).not.toHaveBeenCalled();
  });

  test("spends the roles budget, the same one a promotion spends", async () => {
    const res = await transfer({ userId: "user-2" });
    expect(res.status).toBe(200);
    expect(chargedBuckets).toEqual([DEN_ROLES_RATE_LIMIT.bucket]);
  });

  test("answers 429 without transferring when the limiter denies", async () => {
    mockConsumeDenRateLimit.mockReturnValueOnce(
      Promise.resolve(Response.json({ error: "slow down" }, { status: 429 }))
    );
    const res = await transfer({ userId: "user-2" });
    expect(res.status).toBe(429);
    expect(mockTransferDenOwnership).not.toHaveBeenCalled();
  });

  test("403s somebody who is not the owner", async () => {
    mockTransferDenOwnership.mockRejectedValueOnce(
      new DenError("FORBIDDEN", "Only the owner can do that")
    );
    const res = await transfer({ userId: "user-2" }, { user: { id: "elder" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "FORBIDDEN",
      error: "Only the owner can do that",
    });
  });

  test("409s the owner aiming it at themselves", async () => {
    mockTransferDenOwnership.mockRejectedValueOnce(
      new DenError("SELF_ACTION", "You already own this den")
    );
    const res = await transfer({ userId: "owner" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "SELF_ACTION",
      error: "You already own this den",
    });
  });

  test("404s a target who is not a member", async () => {
    mockTransferDenOwnership.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "That person is not a member")
    );
    const res = await transfer({ userId: "stranger" });
    expect(res.status).toBe(404);
  });

  test("forwards a refusal's sentence rather than replacing it", async () => {
    // The service's messages are written for a person, so the route's job is to
    // carry them rather than to paraphrase them.
    mockTransferDenOwnership.mockRejectedValueOnce(
      new DenError("INVALID_INPUT", "Couldn't generate a join code")
    );
    const res = await transfer({ userId: "user-2" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "INVALID_INPUT",
      error: "Couldn't generate a join code",
    });
  });

  test("a failure that is not a domain refusal is a 500, not a leak", async () => {
    mockTransferDenOwnership.mockRejectedValueOnce(
      new Error("connection terminated unexpectedly")
    );
    const res = await transfer({ userId: "user-2" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Couldn't complete that, try again?",
    });
  });
});
