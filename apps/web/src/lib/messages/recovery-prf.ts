// Pure helpers for the messages recovery credential's PRF flow, split from the
// WebAuthn orchestration so the salt derivation and output parsing are
// unit-testable without a browser.
//
// The PRF (pseudo-random function) extension lets an authenticator evaluate an
// HMAC-like function whose key is internal to the authenticator and never
// leaves it. Given the same credential and the same evaluation input, it
// returns the same 32 bytes — including on a *different device* when the
// credential is a synced passkey. Those bytes derive the messages backup key,
// which is how a fresh device recovers without any human-managed secret.
//
// The evaluation input is public by design (it is an input to the HMAC, not a
// key), so deriving it from the user id is safe and requires no storage.

export const PRF_SALT_VERSION = "v1";

// Deterministic, versioned, domain-separated PRF evaluation input. Async
// because it hashes with WebCrypto. The version prefix means a future change of
// scheme yields a different key rather than silently invalidating enrollments.
export async function derivePrfSalt(
  userId: string
): Promise<Uint8Array<ArrayBuffer>> {
  const input = `asm:messages:prf-recovery:${PRF_SALT_VERSION}:${userId}`;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return new Uint8Array(digest);
}

// Whether the authenticator reported PRF support during registration. An
// authenticator can complete a registration while declining PRF, so this must
// be checked before treating the credential as usable for recovery.
export function prfEnabled(
  results: AuthenticationExtensionsClientOutputs
): boolean {
  return results.prf?.enabled === true;
}

// The PRF output bytes, or null when the authenticator did not return any.
// Absence is expected for authenticators without PRF; the caller falls back to
// the manual recovery secret rather than failing.
export function extractPrfOutput(
  results: AuthenticationExtensionsClientOutputs
): Uint8Array<ArrayBuffer> | null {
  const first = results.prf?.results?.first;
  if (!first) {
    return null;
  }
  // `first` is a BufferSource: normalize either an ArrayBuffer or a view.
  if (first instanceof ArrayBuffer) {
    return new Uint8Array(first);
  }
  return new Uint8Array(
    first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength)
  );
}

// Whether this browser can even attempt the flow. Feature detection only: PRF
// support itself can only be known after a create/get call, which is why the
// caller treats a missing PRF output as "fall back", not "crash".
export function webAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof globalThis.PublicKeyCredential === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.get === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}
