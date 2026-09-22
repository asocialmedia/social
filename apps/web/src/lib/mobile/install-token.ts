import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Per-install credential for the native app.
//
// The web app is protected from cross-site abuse by browser-controlled origin
// metadata, but a native client sends none of it. Treating "no origin" as
// trustworthy would let any script read the same API surface; demanding
// same-origin proof rejects the app. Both guards are also trivially
// defeatable by a script that simply sets `Origin` to the expected value.
//
// So no-origin callers must instead prove they hold a token this server
// issued. The token is stateless (HMAC-signed, nothing to look up), which
// keeps the edge check cheap, and it is issued only from a bootstrap endpoint
// that is itself gated (Turnstile, and platform attestation where available).
//
// Scope, stated honestly: this raises the cost of scripted access to "solve
// the bootstrap challenge and keep a token". It is not app attestation. An
// attacker who solves the challenge gets a token just like a real install.
// Stronger guarantees require Play Integrity / App Attest, which this design
// leaves room for by changing only the bootstrap endpoint.

const TOKEN_VERSION = "v1";
const SECRET_ENV = "MOBILE_INSTALL_SECRET";
const FALLBACK_SECRET_ENV = "BETTER_AUTH_SECRET";

// Installs are long-lived; a token expiring mid-session would log users out
// for no reason. The app re-registers transparently once one ages out.
const DEFAULT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

const BASE64URL_ALPHABET = /^[\w-]+$/;

/** Resolves the signing secret, or null when none is configured. */
export function resolveInstallTokenSecret(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const secret = env[SECRET_ENV]?.trim() || env[FALLBACK_SECRET_ENV]?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return encode(createHmac("sha256", secret).update(payload).digest());
}

export interface InstallToken {
  installId: string;
  issuedAt: number;
}

/** Issues a fresh token for a new install. Returns null without a secret. */
export function issueInstallToken(
  secret: string | null,
  now: number = Date.now()
): { token: string; installId: string } | null {
  if (!secret) {
    return null;
  }
  const installId = encode(randomBytes(16));
  const payload = `${TOKEN_VERSION}.${installId}.${now}`;
  return { installId, token: `${payload}.${sign(payload, secret)}` };
}

/**
 * Verifies a token's signature, shape and age. Returns the decoded token, or
 * null for anything malformed, forged, or expired. Never throws.
 */
export function verifyInstallToken(
  token: string | null | undefined,
  secret: string | null,
  options: { maxAgeMs?: number; now?: number } = {}
): InstallToken | null {
  if (!secret || !token) {
    return null;
  }
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = options.now ?? Date.now();

  const parts = token.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const [version, installId, issuedAtRaw, signature] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (version !== TOKEN_VERSION) {
    return null;
  }
  if (!installId || !BASE64URL_ALPHABET.test(installId)) {
    return null;
  }
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) {
    return null;
  }
  if (issuedAt > now + 60_000) {
    // Future-dated beyond clock skew: forged or a broken client clock.
    return null;
  }
  if (now - issuedAt > maxAgeMs) {
    return null;
  }

  const expected = sign(`${version}.${installId}.${issuedAtRaw}`, secret);
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(provided, expectedBuffer)) {
    return null;
  }

  return { installId, issuedAt };
}

/** Header the native client presents on every request. */
export const INSTALL_TOKEN_HEADER = "x-asm-install";
