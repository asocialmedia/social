import { createHash } from "node:crypto";

import { redis } from "@asm/db";
import { discoveryPageSchema } from "@asm/protocols/discovery";
import type { DiscoveryContent, DiscoveryMode } from "@asm/protocols/discovery";

const RETENTION_SECONDS = 120;

export function discoveryCacheKey(
  mode: DiscoveryMode,
  locale: string,
  topics: string[],
  includeExplicit = false,
  content: DiscoveryContent = "all"
) {
  return `asm:web:bluesky:head:v13:${createHash("sha256")
    .update(JSON.stringify([mode, locale, topics, includeExplicit, content]))
    .digest("hex")}`;
}

export async function cachedDiscoveryHead(key: string) {
  try {
    const saved = await redis.get(key);
    if (!saved) {
      return null;
    }
    const entry = JSON.parse(saved) as { at: number; page: unknown };
    const page = discoveryPageSchema.safeParse(entry.page);
    if (
      !page.success ||
      !Number.isFinite(entry.at) ||
      Date.now() - entry.at > RETENTION_SECONDS * 1000
    ) {
      return null;
    }
    return { at: entry.at, page: page.data };
  } catch {
    return null;
  }
}

export async function saveDiscoveryHead(key: string, page: unknown) {
  const parsed = discoveryPageSchema.parse(page);
  if (parsed.items.length) {
    await redis.set(
      key,
      JSON.stringify({ at: Date.now(), page: parsed }),
      "EX",
      RETENTION_SECONDS
    );
  }
}
