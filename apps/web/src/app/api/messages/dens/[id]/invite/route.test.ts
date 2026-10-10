import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import { DEN_INVITE_ROTATE_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { denRateLimitDouble } from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

// The invite route owns three decisions beyond the service call: the body's
// duration is a whitelist and not a range, an absent body is the forgiving
// "never" default, and the response carries the server-computed expiry so the
// panel never derives a lifetime from its own clock.

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

let limited = false;
const mockConsumeDenRateLimit = mock((_rule: { bucket: string }) =>
  Promise.resolve(
    limited ? Response.json({ error: "slow down" }, { status: 429 }) : null
  )
);
mock.module("@/lib/messages/den-rate-limit", () =>
  denRateLimitDouble(mockConsumeDenRateLimit)
);

let mintResult: {
  inviteCode: string;
  inviteExpiresAt: Date | null;
} = { inviteCode: "freshcode123", inviteExpiresAt: null };
let mintedDuration: unknown = "not-called";
const mockCreateDenInvite = mock(
  (_conversationId: string, _actorId: string, durationDays: unknown) => {
    mintedDuration = durationDays;
    return Promise.resolve(mintResult);
  }
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  DenError,
  createDenInvite: mockCreateDenInvite,
  isDenInviteDurationDays: (value: unknown) =>
    value === 1 || value === 7 || value === 30,
}));

function mint(body?: unknown): Promise<Response> {
  return POST(
    new Request("http://test/api/messages/dens/den-1/invite", {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: "den-1" }) }
  );
}

beforeEach(() => {
  mockGetSession.mockImplementation(() => ({ user: { id: "owner" } }));
  limited = false;
  mintResult = { inviteCode: "freshcode123", inviteExpiresAt: null };
  mintedDuration = "not-called";
  mockCreateDenInvite.mockClear();
});

describe("POST /api/messages/dens/:id/invite", () => {
  test("mints with the chosen preset and answers the server-computed expiry", async () => {
    const expiry = new Date("2026-10-13T12:00:00.000Z");
    mintResult = { inviteCode: "freshcode123", inviteExpiresAt: expiry };
    const res = await mint({ durationDays: 7 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inviteCode?: string;
      inviteExpiresAt?: string | null;
    };
    expect(mintedDuration).toBe(7);
    expect(body.inviteCode).toBe("freshcode123");
    expect(body.inviteExpiresAt).toBe("2026-10-13T12:00:00.000Z");
  });

  test("an absent body reads as no expiry", async () => {
    // The forgiving default: the picker always sends a value, but a caller that
    // does not must get a plain never-expiring link rather than a refusal.
    const res = await mint();
    expect(res.status).toBe(200);
    expect(mintedDuration).toBeNull();
  });

  test("an explicit null duration is the never-expiry choice", async () => {
    const res = await mint({ durationDays: null });
    expect(res.status).toBe(200);
    expect(mintedDuration).toBeNull();
  });

  test("an unknown duration is refused, not coerced", async () => {
    // A range check would accept 365 - a ten-times-longer link than any preset
    // the UI offers - so the whitelist is the rule and the answer is a refusal
    // that names nothing about the den.
    const res = await mint({ durationDays: 365 });
    expect(res.status).toBe(400);
    expect(mockCreateDenInvite).not.toHaveBeenCalled();
  });

  test("the mint is metered under its own bucket", async () => {
    limited = true;
    const res = await mint({ durationDays: 7 });
    expect(res.status).toBe(429);
    expect(mockConsumeDenRateLimit).toHaveBeenCalledWith(
      DEN_INVITE_ROTATE_RATE_LIMIT,
      "owner"
    );
    expect(mockCreateDenInvite).not.toHaveBeenCalled();
  });

  test("401s before reading anything, when there is no session", async () => {
    mockGetSession.mockImplementation(() => null);
    const res = await mint({ durationDays: 7 });
    expect(res.status).toBe(401);
    expect(mockCreateDenInvite).not.toHaveBeenCalled();
  });

  test("a service refusal keeps its shape", async () => {
    mockCreateDenInvite.mockImplementation(() =>
      Promise.reject(new DenError("FORBIDDEN", "Not a manager"))
    );
    const res = await mint({ durationDays: 7 });
    expect(res.status).toBe(403);
  });
});
