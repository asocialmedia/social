import {
  scrypt as nodeScrypt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen = 64
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      keylen,
      { N: 16_384, r: 8, p: 1 },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      }
    );
  });
}

export async function hashPasswordWithScrypt(
  password: string
): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64);
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
  const N = Number.parseInt(nStr, 10);
  const r = Number.parseInt(rStr, 10);
  const p = Number.parseInt(pStr, 10);
  if (!(Number.isFinite(N) && Number.isFinite(r) && Number.isFinite(p))) {
    return false;
  }
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, expected.length, { N, r, p }, (err, dk) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(dk);
    });
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
  stored: unknown
): Promise<boolean> {
  const normalized = normalizePasswordHash(stored);
  if (typeof normalized !== "string") {
    return false;
  }
  return await verifyPasswordWithScrypt(password, normalized);
}
