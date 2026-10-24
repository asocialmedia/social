// The public upstream is simulated; this benchmark never load-tests Bluesky's infrastructure.
// oxlint-disable no-await-in-loop
import { setTimeout as delay } from "node:timers/promises";

import { BlueskyClient } from "@asm/protocols/bluesky";

import { createProtocolsApp } from "../src/app";
import { createBlueskySearch } from "../src/search";

const upstreamMs = 600;
if (Number(process.env.BUN_CONFIG_MAX_HTTP_REQUESTS ?? "256") < 1024) {
  throw new Error(
    "Run with BUN_ CONFIG_MAX_HTTP_REQUESTS=2048 so the load generator does not queue the offered spike."
  );
}
const token = "local_search_benchmark_credential_0000";
const reports: object[] = [];
const authorDid = "did:plc:z72i7hdynmk6r22z27h6tvur";
const authors = Array.from({ length: 6 }, (_, index) => ({
  description: "A public profile used for a local capacity benchmark.",
  did: authorDid,
  displayName: `Example ${index}`,
  handle: `example${index}.bsky.social`,
}));
const posts = Array.from({ length: 6 }, (_, index) => ({
  author: authors[index],
  cid: "bafyreibfn4d6xedoe6jixkcl266v2fhiwga2x3zzsnq6yawnago2kb5ouu",
  indexedAt: "2026-10-19T00:00:00.000Z",
  record: {
    $type: "app.bsky.feed.post",
    createdAt: "2026-10-19T00:00:00.000Z",
    text: "A public post about software and astronomy. ".repeat(5),
  },
  uri: `at://${authorDid}/app.bsky.feed.post/example${index}`,
}));
let upstreamCalls = 0;
let feedCalls = 0;
const searchClient = new BlueskyClient({
  fetch: async (url) => {
    upstreamCalls += 1;
    await delay(upstreamMs);
    return Response.json(
      url.includes("searchActors") ? { actors: authors } : { posts }
    );
  },
  maxConcurrentRequests: 48,
  maxRetries: 0,
  timeoutMs: 2500,
});
const feedClient = new BlueskyClient({
  fetch: async () => {
    feedCalls += 1;
    await delay(upstreamMs);
    return Response.json({ feed: [] });
  },
  maxConcurrentRequests: 48,
  maxRetries: 0,
});
const search = createBlueskySearch({ client: searchClient });
const logger = {
  debug: () => {
    // Benchmark logger is intentionally silent.
  },
  error: () => {
    // Benchmark logger is intentionally silent.
  },
  info: () => {
    // Benchmark logger is intentionally silent.
  },
  warn: () => {
    // Benchmark logger is intentionally silent.
  },
};
const app = createProtocolsApp({
  client: feedClient,
  health: () => ({
    connected: false,
    draining: false,
    jetstreamEnabled: false,
    lastEventAt: null,
    leaseHeld: false,
    processedEvents: 0,
  }),
  logger,
  search,
  token,
});
const server = Bun.serve({
  fetch: (incoming) => app.handle(incoming),
  hostname: "127.0.0.1",
  port: 0,
});

async function request(query: string) {
  const start = performance.now();
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/v1/bluesky/search?q=${encodeURIComponent(query)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(11_000),
      }
    );
    const result = await response.json();
    return {
      ms: performance.now() - start,
      partial: Boolean(result.unavailable?.length),
      status: response.status,
    };
  } catch {
    return { ms: performance.now() - start, partial: false, status: 0 };
  }
}

async function batch(
  name: string,
  count: number,
  term: (index: number) => string,
  rate?: number
) {
  const before = upstreamCalls;
  const started = performance.now();
  const pending: ReturnType<typeof request>[] = [];
  for (let index = 0; index < count; index += 1) {
    if (rate) {
      await delay(
        Math.max(0, started + (index * 1000) / rate - performance.now())
      );
    }
    pending.push(request(term(index)));
  }
  const results = await Promise.all(pending);
  const times = results
    .filter((result) => result.status === 200 && !result.partial)
    .map((result) => result.ms)
    .toSorted((left, right) => left - right);
  const statuses: Record<string, number> = {};
  for (const result of results) {
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
  }
  const report = {
    elapsedMs: Math.round(performance.now() - started),
    name,
    partial: results.filter((result) => result.partial).length,
    rate: rate ?? "burst",
    requests: count,
    statuses,
    successfulP50Ms: Math.round(times[Math.floor(times.length * 0.5)] ?? 0),
    successfulP95Ms: Math.round(times[Math.floor(times.length * 0.95)] ?? 0),
    upstreamCalls: upstreamCalls - before,
  };
  reports.push(report);
  console.log(JSON.stringify(report));
}

try {
  await batch(
    "1000 offered requests sharing 10 cold queries",
    1000,
    (index) => `common ${index % 10}`
  );
  await batch(
    "1000 offered requests sharing 10 warm queries",
    1000,
    (index) => `common ${index % 10}`
  );
  await batch(
    "100 distinct cold queries in a burst",
    100,
    (index) => `burst ${index}`
  );
  await batch(
    "200 distinct cold queries in a spike",
    200,
    (index) => `spike ${index}`
  );
  await batch(
    "1000 distinct cold queries, paced at 25 searches per second",
    1000,
    (index) => `paced ${index}`,
    25
  );
  const overloaded = batch(
    "1000 distinct cold queries in an overload burst",
    1000,
    (index) => `overload ${index}`
  );
  const feedStart = performance.now();
  const feed = await feedClient.getFeed(
    "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.generator/whats-hot"
  );
  reports.push({
    feedCalls,
    feedLatencyMs: Math.round(performance.now() - feedStart),
    name: "independent feed during search overload",
    posts: feed.items.length,
  });
  await overloaded;
  console.log(JSON.stringify({ feedCalls, queue: search.stats() }));
  await Bun.write(
    process.env.SEARCH_BENCH_OUTPUT ?? "/tmp/asm-search-hardened-load.json",
    JSON.stringify(
      {
        note: "Local real HTTP/Elysia and real adapter; 600ms simulated upstream; no Redis or Next gateway in this component benchmark. Not a production end-to-end result.",
        reports,
      },
      null,
      2
    )
  );
} finally {
  search.close();
  searchClient.close();
  feedClient.close();
  server.stop(true);
}
