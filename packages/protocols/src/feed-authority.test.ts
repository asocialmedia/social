import { expect, test } from "bun:test";

import {
  decideFeedAuthority,
  feedSourceStreak,
  mixRankedNetworks,
  protocolFeedHealthSchema,
  readFeedHealth,
} from "./feed-authority";
import type {
  FeedNetwork,
  MediaFeedHealth,
  ProtocolFeedHealth,
} from "./feed-authority";
import { reconcileFeedOrder } from "./feed-coordinator";

const now = 1_000_000;
const health: ProtocolFeedHealth = {
  eligiblePostAt: now - 1000,
  inventoryCount: 20,
  observedAt: now,
  readyWorkers: 2,
  streamConnected: true,
  streamEnabled: true,
  streamEventAt: now - 100,
  streamSourceAt: now - 110,
  upstream: { failed: 0, limited: 12, succeeded: 0 },
};

test("a saturated AppView pauses mixed reads until verified capacity or expiry", () => {
  expect(decideFeedAuthority(health, null, now).bluesky).toEqual({
    reason: "rate_limited",
    retryAt: now + 20_000,
  });
  const recovered = {
    ...health,
    upstream: { ...health.upstream, succeeded: 1 },
  };
  expect(decideFeedAuthority(recovered, null, now).bluesky).toBeUndefined();
  expect(
    readFeedHealth(
      protocolFeedHealthSchema,
      JSON.stringify(health),
      now + 45_000
    )
  ).toBeNull();
  expect(
    readFeedHealth(protocolFeedHealthSchema, "{ malformed", now)
  ).toBeNull();
  expect(decideFeedAuthority(null, null, now).bluesky).toBeUndefined();
});

test("stream lag alone leaves a fresh validated inventory usable", () => {
  const quiet = {
    ...health,
    upstream: { failed: 0, limited: 0, succeeded: 0 },
  };
  const stalled = { ...quiet, streamEventAt: now - 130_000 };
  expect(decideFeedAuthority(stalled, null, now).bluesky).toBeUndefined();
  expect(
    decideFeedAuthority({ ...stalled, eligiblePostAt: null }, null, now).bluesky
      ?.reason
  ).toBe("inventory_stale");
  expect(
    decideFeedAuthority(
      { ...stalled, eligiblePostAt: null, streamEventAt: null },
      null,
      now
    ).bluesky
  ).toBeUndefined();
  const replay = {
    ...quiet,
    eligiblePostAt: null,
    streamEventAt: now,
    streamSourceAt: now - 301_000,
  };
  expect(decideFeedAuthority(replay, null, now).bluesky?.reason).toBe(
    "inventory_stale"
  );
});

test("safety pressure pauses new admissions while enrichment and network can continue", () => {
  const media: MediaFeedHealth = {
    classifier: "busy",
    classifierQueued: 16,
    enrichmentOldestMs: 300_000,
    observedAt: now,
    safetyOldestMs: 90_000,
    safetyWaiting: 2,
  };
  const decision = decideFeedAuthority(null, media, now);
  expect(decision).toEqual({ acceptSafetyJobs: false, bluesky: undefined });
  expect(
    decideFeedAuthority(null, { ...media, classifier: "ready" }, now)
      .acceptSafetyJobs
  ).toBe(true);
  expect(
    decideFeedAuthority(
      null,
      { ...media, classifier: "ready", safetyOldestMs: 121_000 },
      now
    ).acceptSafetyJobs
  ).toBe(false);
});

const posts = (kind: FeedNetwork, size: number) =>
  Array.from({ length: size }, (_, index) => ({
    id: `${kind}:${index}`,
    kind,
  }));

test("balanced ranking varies source runs while preserving both source rankings", () => {
  const native = posts("asm", 20);
  const external = posts("bluesky", 20);
  const rows = mixRankedNetworks(native, external);
  const sequence = rows.map((row) => row.kind);
  expect(feedSourceStreak(sequence)).toBeLessThanOrEqual(3);
  expect(feedSourceStreak(sequence)).toBeGreaterThan(1);
  expect(rows.filter((row) => row.kind === "asm")).toEqual(native);
  expect(rows.filter((row) => row.kind === "bluesky")).toEqual(external);
});

test("the next page honors the preceding streak without shifting any visible posts", () => {
  const native = posts("asm", 10);
  const external = posts("bluesky", 10);
  const visible = native.slice(0, 3);
  const next = reconcileFeedOrder(
    visible,
    mixRankedNetworks(native, external),
    [native.map((post) => post.id), external.map((post) => post.id)],
    (post) => post.kind
  );
  expect(next.slice(0, 3)).toEqual(visible);
  expect(next[3]?.kind).toBe("bluesky");
  expect(new Set(next.map((post) => post.id)).size).toBe(20);
  expect(mixRankedNetworks(native, [])).toEqual(native);
});
