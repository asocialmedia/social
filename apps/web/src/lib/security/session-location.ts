import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { redis } from "@asm/db";

export interface SessionLocation {
  city: string | null;
  country: string | null;
}

export function isPublicSessionAddress(value: string): boolean {
  if (!isIP(value)) {
    return false;
  }
  if (value.includes(":")) {
    const normalized = value.toLowerCase();
    return (
      !normalized.startsWith("::") &&
      !normalized.startsWith("fc") &&
      !normalized.startsWith("fd") &&
      !normalized.startsWith("fe80") &&
      !normalized.startsWith("ff")
    );
  }
  const [first = 0, second = 0] = value.split(".").map(Number);
  return (
    first !== 0 &&
    first !== 10 &&
    first !== 127 &&
    first < 224 &&
    !(first === 169 && second === 254) &&
    !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && second === 168) &&
    !(first === 100 && second >= 64 && second <= 127)
  );
}

export function parseSessionLocation(value: unknown): SessionLocation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const city: unknown = Reflect.get(value, "city");
  const country: unknown = Reflect.get(value, "country_code");
  if (
    Reflect.get(value, "success") !== true ||
    typeof country !== "string" ||
    !/^[A-Z]{2}$/.test(country)
  ) {
    return null;
  }
  return {
    city:
      typeof city === "string" && city.trim()
        ? city.trim().slice(0, 128)
        : null,
    country,
  };
}

const flights = new Map<string, Promise<SessionLocation | null>>();

// Coarse network location is cached independently of authentication; session revocation never uses this cache.
export async function getSessionLocation(
  address: string | null
): Promise<SessionLocation | null> {
  if (!address || !isPublicSessionAddress(address)) {
    return null;
  }
  const key = `security:location:v1:${createHash("sha256").update(address).digest("hex")}`;
  const existing = flights.get(key);
  if (existing) {
    return existing;
  }
  const request = (async () => {
    try {
      const cached = await redis.get(key);
      if (cached) {
        return parseSessionLocation(JSON.parse(cached));
      }
      const response = await fetch(
        `https://ipwho.is/${encodeURIComponent(address)}?fields=success,city,country_code`,
        {
          signal: AbortSignal.timeout(1500),
        }
      );
      const location = response.ok
        ? parseSessionLocation(await response.json())
        : null;
      await redis.set(
        key,
        JSON.stringify({
          city: location?.city,
          country_code: location?.country,
          success: Boolean(location),
        }),
        "EX",
        location ? 30 * 24 * 60 * 60 : 60 * 60
      );
      return location;
    } catch {
      return null;
    }
  })();
  flights.set(key, request);
  try {
    return await request;
  } finally {
    flights.delete(key);
  }
}
