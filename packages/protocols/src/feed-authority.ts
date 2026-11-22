import { z } from "zod";

export const feedAuthorityVersion = 1;
export const feedAuthorityKeys = {
  media: "asm:{feed-authority}:media:v1",
  native: "asm:{feed-authority}:native:v1",
  protocols: "asm:{feed-authority}:protocols:v1",
  workers: "asm:{feed-authority}:worker-ids:v2",
};
export const feedAuthorityExpirySeconds = 45;

const timestamp = z.number().int().nonnegative();
const count = z.number().int().nonnegative();
export const protocolFeedHealthSchema = z.object({
  eligiblePostAt: timestamp.nullable(),
  inventoryCount: count,
  observedAt: timestamp,
  readyWorkers: count,
  streamConnected: z.boolean(),
  streamEnabled: z.boolean(),
  streamEventAt: timestamp.nullable(),
  streamSourceAt: timestamp.nullable(),
  upstream: z.object({
    failed: count,
    limited: count,
    succeeded: count,
  }),
  workers: z
    .array(
      z.object({
        active: count,
        capacity: count,
        id: z.string().max(48),
        version: z.string().max(100),
      })
    )
    .max(8)
    .optional(),
});
export type ProtocolFeedHealth = z.infer<typeof protocolFeedHealthSchema>;

export const mediaFeedHealthSchema = z.object({
  classifier: z.enum(["unconfigured", "ready", "busy", "unavailable"]),
  classifierQueued: count.nullable(),
  enrichmentOldestMs: count,
  observedAt: timestamp,
  safetyOldestMs: count,
  safetyWaiting: count,
});
export type MediaFeedHealth = z.infer<typeof mediaFeedHealthSchema>;

export const feedSourceStatusSchema = z.object({
  reason: z.enum(["inventory_stale", "rate_limited", "upstream_unavailable"]),
  retryAt: timestamp,
});
export type FeedSourceStatus = z.infer<typeof feedSourceStatusSchema>;

export function readFeedHealth<T extends { observedAt: number }>(
  schema: z.ZodType<T>,
  raw: string | null,
  now = Date.now()
): T | null {
  if (!raw || raw.length > 8192) {
    return null;
  }
  try {
    const value = schema.parse(JSON.parse(raw));
    const age = now - value.observedAt;
    return age >= -5000 && age < feedAuthorityExpirySeconds * 1000
      ? value
      : null;
  } catch {
    return null;
  }
}

export function decideFeedAuthority(
  protocols: ProtocolFeedHealth | null,
  media: MediaFeedHealth | null,
  now = Date.now()
) {
  const upstream = protocols?.upstream;
  let bluesky: FeedSourceStatus | undefined;
  if (upstream && upstream.succeeded === 0) {
    if (upstream.limited >= 3) {
      bluesky = { reason: "rate_limited", retryAt: now + 20_000 };
    } else if (upstream.failed >= 5) {
      bluesky = { reason: "upstream_unavailable", retryAt: now + 20_000 };
    } else if (
      protocols?.streamEnabled &&
      protocols.streamEventAt !== null &&
      (now - protocols.streamEventAt > 120_000 ||
        (protocols.streamSourceAt !== null &&
          now - protocols.streamSourceAt > 300_000)) &&
      (protocols.eligiblePostAt === null ||
        now - protocols.eligiblePostAt > 30 * 60_000)
    ) {
      bluesky = { reason: "inventory_stale", retryAt: now + 20_000 };
    }
  }
  return {
    acceptSafetyJobs:
      !media ||
      (media.classifier !== "unavailable" &&
        media.classifier !== "busy" &&
        media.safetyWaiting < 400 &&
        media.safetyOldestMs < 120_000),
    bluesky,
  };
}

export type FeedNetwork = "asm" | "bluesky";

export function mixRankedNetworks<T extends { kind: FeedNetwork }>(
  native: readonly T[],
  external: readonly T[],
  previous: readonly T[] = []
): T[] {
  const result: T[] = [];
  let nativeIndex = 0;
  let externalIndex = 0;
  const recent = previous.slice(-8).map((item) => item.kind);
  const offsets = [0, 0, 1, -1, 0, -1, 1];

  while (nativeIndex < native.length && externalIndex < external.length) {
    const balance = recent.reduce(
      (total, source) => total + (source === "asm" ? 1 : -1),
      0
    );
    const last = recent.at(-1);
    const streak =
      last &&
      recent.slice(-3).length === 3 &&
      recent.slice(-3).every((source) => source === last);
    const offset =
      offsets[(previous.length + result.length) % offsets.length] ?? 0;
    const takeNative = streak ? last === "bluesky" : balance <= offset;
    const item = takeNative ? native[nativeIndex] : external[externalIndex];
    if (takeNative) {
      nativeIndex += 1;
    } else {
      externalIndex += 1;
    }
    if (!item) {
      break;
    }
    result.push(item);
    recent.push(item.kind);
    if (recent.length > 8) {
      recent.shift();
    }
  }
  return [
    ...result,
    ...native.slice(nativeIndex),
    ...external.slice(externalIndex),
  ];
}

export function feedSourceStreak(items: readonly FeedNetwork[]) {
  let previous: FeedNetwork | undefined;
  let current = 0;
  let longest = 0;
  for (const source of items) {
    current = source === previous ? current + 1 : 1;
    previous = source;
    longest = Math.max(longest, current);
  }
  return longest;
}

export const feedMixReportSchema = z
  .object({
    client: z.enum(["web", "mobile"]),
    durationMs: z.number().int().min(0).max(60_000),
    mode: z.enum(["latest", "personalized", "trending"]),
    sources: z
      .array(z.enum(["asm", "bluesky"]))
      .min(1)
      .max(20),
  })
  .strict();
export type FeedMixReport = z.infer<typeof feedMixReportSchema>;

export async function sendFeedMixReport(
  input: FeedMixReport,
  options: { baseUrl?: string; headers?: HeadersInit } = {}
) {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  try {
    await fetch(`${options.baseUrl ?? ""}/api/recommendations/feed-delivery`, {
      body: JSON.stringify(input),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Feed rendering does not depend on telemetry delivery.
  }
}
