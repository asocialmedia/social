import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";

import { DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { denRateLimitDouble } from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

// The invite short code route mirrors the link route: whitelisted duration,
// absent body defaults to null (never), server computes expiry, and metered
// under its own dedicated rate limit bucket.

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
  inviteShortCode: string;
  inviteShortCodeExpiresAt: Date | null;
} = { inviteShortCode: "ABC123", inviteShortCodeExpiresAt: null };
let mintedDuration: unknown = "not-called";
const mockCreateDenShortCode = mock(
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
  createDenShortCode: mockCreateDenShortCode,
  isDenInviteDurationDays: (value: unknown) =>
    value === 1 || value === 7 || value === 30,
}));

function mint(body?: unknown): Promise<Response> {
  return POST(
    new Request("http://test/api/messages/dens/den-1/invite-code", {
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
  mintResult = { inviteShortCode: "ABC123", inviteShortCodeExpiresAt: null };
  mintedDuration = "not-called";
  mockCreateDenShortCode.mockClear();
});

describe("POST /api/messages/dens/:id/invite-code", () => {
  test("mints with the chosen preset and answers the server-computed expiry", async () => {
    const expiry = new Date("2026-10-13T12:00:00.000Z");
    mintResult = {
      inviteShortCode: "ABC123",
      inviteShortCodeExpiresAt: expiry,
    };
    const res = await mint({ durationDays: 7 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inviteShortCode?: string;
      inviteShortCodeExpiresAt?: string | null;
    };
    expect(mintedDuration).toBe(7);
    expect(body.inviteShortCode).toBe("ABC123");
    expect(body.inviteShortCodeExpiresAt).toBe("2026-10-13T12:00:00.000Z");
  });

  test("an absent body reads as no expiry", async () => {
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
    const res = await mint({ durationDays: 365 });
    expect(res.status).toBe(400);
    expect(mockCreateDenShortCode).not.toHaveBeenCalled();
  });

  test("the mint is metered under its own bucket", async () => {
    limited = true;
    const res = await mint({ durationDays: 7 });
    expect(res.status).toBe(429);
    expect(mockConsumeDenRateLimit).toHaveBeenCalledWith(
      DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT,
      "owner"
    );
    expect(mockCreateDenShortCode).not.toHaveBeenCalled();
  });

  test("401s before reading anything, when there is no session", async () => {
    mockGetSession.mockImplementation(() => null);
    const res = await mint({ durationDays: 7 });
    expect(res.status).toBe(401);
    expect(mockCreateDenShortCode).not.toHaveBeenCalled();
  });

  test("a service refusal keeps its shape", async () => {
    mockCreateDenShortCode.mockImplementation(() =>
      Promise.reject(new DenError("FORBIDDEN", "Not a manager"))
    );
    const res = await mint({ durationDays: 7 });
    expect(res.status).toBe(403);
  });
});
