import { redis } from "@asm/db";
import { createLogger } from "@asm/logger";
import {
  abortable,
  decideFeedAuthority,
  feedAuthorityKeys,
  feedAuthorityVersion,
  feedSourceStreak,
  mediaFeedHealthSchema,
  protocolFeedHealthSchema,
  readFeedHealth,
} from "@asm/protocols/discovery";
import type { FeedMixReport } from "@asm/protocols/discovery";
import { metrics } from "@opentelemetry/api";

const logger = createLogger({ serviceName: "feed-authority" });
const meter = metrics.getMeter("feed-authority");
const sourceStreak = meter.createHistogram("asm.feed.source_streak");
const firstContent = meter.createHistogram("asm.feed.first_content", {
  unit: "ms",
});
const newestAge = meter.createHistogram("asm.feed.newest_served_age", {
  unit: "ms",
});
const served = meter.createCounter("asm.feed.served");
const matched = meter.createCounter("asm.feed.interest_matches");
const inspected = meter.createCounter("asm.feed.interest_candidates");
const feedback = meter.createCounter("asm.feed.feedback_received");
const lastReport = new Map<string, number>();
let snapshot: Awaited<ReturnType<typeof readSnapshot>> | undefined;
let loading: ReturnType<typeof readSnapshot> | undefined;
let refreshAt = 0;

async function readSnapshot() {
  try {
    const [protocols, media, native] = await abortable(
      redis.mget(
        feedAuthorityKeys.protocols,
        feedAuthorityKeys.media,
        feedAuthorityKeys.native
      ),
      AbortSignal.timeout(60)
    );
    return { media, native, protocols };
  } catch {
    return { media: null, native: null, protocols: null };
  }
}

export async function readFeedAuthority() {
  const now = Date.now();
  if (!snapshot || now >= refreshAt) {
    loading ??= readSnapshot();
    const read = loading;
    snapshot = await read;
    if (loading === read) {
      loading = undefined;
      refreshAt = Date.now() + 3000;
    }
  }
  const protocols = readFeedHealth(
    protocolFeedHealthSchema,
    snapshot.protocols,
    now
  );
  const media = readFeedHealth(mediaFeedHealthSchema, snapshot.media, now);
  const native = Number(snapshot.native);
  return {
    media,
    nativePublishedAt:
      Number.isSafeInteger(native) && native > 0 && native <= now
        ? native
        : null,
    protocols,
    ...decideFeedAuthority(protocols, media, now),
  };
}

export function reportFeedServing(input: {
  source: "asm" | "bluesky";
  mode: string;
  items: number;
  newestAt: number;
  matches?: number;
  eligible?: number;
  withheld?: number;
  reason?: string;
  nativePublishedAt?: number | null;
}) {
  const attributes = {
    mode: input.mode,
    reason: input.reason ?? "available",
    source: input.source,
  };
  const age =
    input.newestAt > 0 ? Math.max(0, Date.now() - input.newestAt) : null;
  if (age !== null) {
    newestAge.record(age, attributes);
  }
  served.add(input.items, attributes);
  if (input.matches !== undefined) {
    matched.add(input.matches, attributes);
    inspected.add(input.items, attributes);
  }
  const key = JSON.stringify(attributes);
  if (Date.now() - (lastReport.get(key) ?? 0) < 15_000) {
    return;
  }
  lastReport.set(key, Date.now());
  logger.info(
    {
      ...input,
      event: "feed.authority.served",
      newestAgeMs: age,
      policyVersion: feedAuthorityVersion,
    },
    "Feed authority recorded a served page"
  );
}

export function reportFeedFeedback(
  source: "asm" | "bluesky",
  eventCounts: Record<string, number>
) {
  for (const [event, count] of Object.entries(eventCounts)) {
    feedback.add(count, { event, source });
  }
}

export function reportFeedMix(input: FeedMixReport) {
  const bluesky = input.sources.filter((source) => source === "bluesky").length;
  const attributes = { client: input.client, mode: input.mode };
  const longest = feedSourceStreak(input.sources);
  sourceStreak.record(longest, attributes);
  firstContent.record(input.durationMs, attributes);
  logger.info(
    {
      ...attributes,
      asm: input.sources.length - bluesky,
      bluesky,
      durationMs: input.durationMs,
      event: "feed.authority.delivered",
      longest,
      policyVersion: feedAuthorityVersion,
    },
    "Feed authority recorded the displayed feed"
  );
}
