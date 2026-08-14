import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import type { BinaryLike, ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// `promisify` cannot infer the options overload or the Buffer return of
// node:crypto's scrypt, so the result is typed explicitly.
const scryptAsync = promisify(nodeScrypt) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

const SCRYPT_DEFAULTS: ScryptOptions = {
  N: 16_384,
  p: 1,
  r: 8,
};

export async function hashPasswordWithScrypt(
  password: string
): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64, SCRYPT_DEFAULTS);
  const saltB64 = salt.toString("base64");
  const keyB64 = derivedKey.toString("base64");
  return `scrypt$16384$8$1$${saltB64}$${keyB64}`;
}

export async function verifyPasswordWithScrypt(
  password: string,
  stored: string
): Promise<boolean> {
  // Expected format: scrypt$N$r$p$<saltB64>$<keyB64>
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Math.trunc(Number(nStr));
  const r = Math.trunc(Number(rStr));
  const p = Math.trunc(Number(pStr));
  if (!(Number.isFinite(N) && Number.isFinite(r) && Number.isFinite(p))) {
    return false;
  }
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  const derivedKey = await scryptAsync(password, salt, expected.length, {
    N,
    p,
    r,
  });
  if (derivedKey.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derivedKey, expected);
}

/**
 * Normalize a stored password hash that may be either a raw scrypt string
 * or a JSON-wrapped `{"hash": "..."}` value (the legacy representation).
 * Returns the raw scrypt hash to verify against, or undefined when the
 * stored value is not a recognizable string.
 */
export function normalizePasswordHash(stored: unknown): string | undefined {
  if (typeof stored !== "string") {
    return;
  }
  try {
    const parsed = JSON.parse(stored);
    if (
      parsed &&
      typeof parsed === "object" &&
      "hash" in (parsed as Record<string, unknown>) &&
      typeof (parsed as Record<string, unknown>).hash === "string"
    ) {
      return (parsed as Record<string, string>).hash;
    }
  } catch {
    // Not JSON; fall through to the raw string.
  }
  return stored;
}

/**
 * Verify a plain password against a stored hash that may be a raw scrypt
 * string or a JSON-wrapped `{"hash": "..."}` value.
 */
export async function verifyPasswordHash(
  password: string,
  stored?: unknown
): Promise<boolean> {
  const normalized = normalizePasswordHash(stored);
  if (typeof normalized !== "string") {
    return false;
  }
  return await verifyPasswordWithScrypt(password, normalized);
}
