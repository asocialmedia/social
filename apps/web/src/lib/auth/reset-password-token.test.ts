import { describe, expect, test } from "bun:test";

import {
  checkResetPasswordToken,
  resetPasswordTokenIdentifier,
} from "./reset-password-token";

// This is the rule behind GET /api/reset-password, which the mobile client
// calls before showing the confirm form. The route itself is glue around it
// (a `connection()` claim, a Prisma lookup and a Response per outcome), and it
// cannot be invoked from a test: `connection()` throws outside a request scope,
// and standing up the auth-service graph the route also serves POST with would
// mean mocking most of the app.
const NOW = new Date("2026-09-26T12:00:00.000Z");
const TOKEN = "reset-token-123";

function inMs(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

describe("resetPasswordTokenIdentifier", () => {
  test("looks the token up under the better-auth prefix", () => {
    // A raw identifier resolves nothing, which rejects every valid reset link.
    expect(resetPasswordTokenIdentifier(TOKEN)).toBe(`reset-password:${TOKEN}`);
  });
});

describe("checkResetPasswordToken", () => {
  test("rejects a request with no token", () => {
    expect(checkResetPasswordToken({ now: NOW, token: null })).toEqual({
      kind: "missing-token",
    });
    expect(checkResetPasswordToken({ now: NOW, token: "" })).toEqual({
      kind: "missing-token",
    });
    expect(
      checkResetPasswordToken({ now: NOW, token: undefined })
    ).toStrictEqual({ kind: "missing-token" });
  });

  test("rejects a token with no verification row", () => {
    expect(
      checkResetPasswordToken({ now: NOW, storedExpiresAt: null, token: TOKEN })
    ).toEqual({ kind: "unknown-token" });
  });

  test("accepts a row that has not expired", () => {
    expect(
      checkResetPasswordToken({
        now: NOW,
        storedExpiresAt: inMs(60_000),
        token: TOKEN,
      })
    ).toEqual({ kind: "valid" });
  });

  test("treats the expiry second itself as expired, not valid", () => {
    expect(
      checkResetPasswordToken({
        now: NOW,
        storedExpiresAt: NOW,
        token: TOKEN,
      })
    ).toEqual({ kind: "expired" });
    expect(
      checkResetPasswordToken({
        now: NOW,
        storedExpiresAt: inMs(-1),
        token: TOKEN,
      })
    ).toEqual({ kind: "expired" });
  });

  test("never reports a token as valid without a row to check against", () => {
    // The order matters: a token with no row is unknown, not valid, even though
    // "no expiry" could otherwise read as "nothing to have expired".
    expect(
      checkResetPasswordToken({ now: NOW, storedExpiresAt: null, token: TOKEN })
        .kind
    ).toBe("unknown-token");
  });
});
