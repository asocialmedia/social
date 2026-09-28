// Deciding whether a password reset link is usable, with no Next, Prisma or
// better-auth imports so it is unit-testable on Node.
//
// The route this belongs to is the mobile-facing GET /api/reset-password: it
// answers "is this link still good?" before the confirm form is shown, and it
// has to be a per-request read of the verification row. Keeping the decision
// here is what makes that behaviour testable at all - the route itself calls
// `connection()`, Next's opt-out of prerendering, which throws when a handler
// is invoked outside a request scope.

/**
 * Better-auth stores reset tokens in the verification table under a
 * `reset-password:{token}` identifier. Built here rather than inlined in the
 * route so the prefix is part of what the tests pin: a lookup with a raw
 * identifier resolves nothing and rejects every valid link.
 */
export const RESET_PASSWORD_TOKEN_PREFIX = "reset-password:";

export function resetPasswordTokenIdentifier(token: string): string {
  return `${RESET_PASSWORD_TOKEN_PREFIX}${token}`;
}

export type ResetPasswordTokenCheck =
  // No token in the URL at all.
  | { kind: "missing-token" }
  // A token was given, but no verification row matches it.
  | { kind: "unknown-token" }
  // The row exists but is past its expiry, and the caller purges it.
  | { kind: "expired" }
  | { kind: "valid" };

/**
 * `storedExpiresAt` is the matched row's expiry, or null when the lookup found
 * nothing. Kept as a value rather than a lookup callback so the rule can be
 * stated - and tested - without a database.
 */
export function checkResetPasswordToken({
  now = new Date(),
  storedExpiresAt = null,
  token,
}: {
  now?: Date;
  storedExpiresAt?: Date | null;
  token: string | null | undefined;
}): ResetPasswordTokenCheck {
  if (!token) {
    return { kind: "missing-token" };
  }
  if (storedExpiresAt === null) {
    return { kind: "unknown-token" };
  }
  // At the expiry second, not after it: an expiry is the instant the token stops
  // being valid (the same rule JWT `exp` follows), and a single-use secret
  // should fail closed on the boundary rather than open for one millisecond.
  if (storedExpiresAt <= now) {
    return { kind: "expired" };
  }
  return { kind: "valid" };
}
