import { redis } from "@asm/db";

import { resolveAppOrigin } from "@/lib/auth/auth-internal";

// Server-side support for the messages recovery credential: a WebAuthn
// credential whose PRF output derives the messages backup key. Separate from
// sign-in passkeys on purpose (see the MessageRecoveryCredential model).
//
// The PRF extension is not handled here at all. It is a client-side extension:
// the browser adds `extensions.prf` to the create/get call itself, and the
// resulting output never reaches the server. The server only builds the
// challenge/allowCredentials and verifies the signature, which is unaffected by
// the extension. This also sidesteps the fact that @simplewebauthn v13's DOM
// types do not model `prf`.

export const RECOVERY_RP_NAME = "asocialmedia";

// The relying-party id (registrable domain) and its origin, derived from the
// app origin so they cannot drift from the sign-in passkey configuration.
export function resolveRecoveryRpId(): string {
  return new URL(resolveAppOrigin()).hostname;
}

export function resolveRecoveryOrigin(): string {
  return new URL(resolveAppOrigin()).origin;
}

// Challenges are single-use and short-lived. Keyed by user and purpose so a
// registration challenge can never be replayed as an authentication one.
const CHALLENGE_TTL_SECONDS = 300;

function challengeKey(userId: string, purpose: "authenticate" | "register") {
  return `msg:recovery:challenge:${purpose}:${userId}`;
}

export async function storeChallenge(
  userId: string,
  purpose: "authenticate" | "register",
  challenge: string
): Promise<void> {
  await redis.set(
    challengeKey(userId, purpose),
    challenge,
    "EX",
    CHALLENGE_TTL_SECONDS
  );
}

// Reads and consumes the stored challenge. Returns null when absent/expired, so
// the caller rejects rather than verifying against a stale or missing value.
export async function consumeChallenge(
  userId: string,
  purpose: "authenticate" | "register"
): Promise<string | null> {
  const key = challengeKey(userId, purpose);
  const value = await redis.get(key);
  if (value === null) {
    return null;
  }
  // Delete before use: a challenge must not be replayable if verification
  // itself throws partway through.
  await redis.del(key);
  return value;
}

// ---- base64url helpers -------------------------------------------------------

// Credential ids and COSE public keys are stored as base64url strings: they are
// opaque byte blobs (not text), and base64url survives JSON, cookies, and DB
// round-trips without escaping. Node's Buffer supports base64url natively, and
// these routes run in the Node runtime.
export function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(value, "base64url");
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}
