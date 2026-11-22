import { expect, mock, test } from "bun:test";

import { createReadWorkerPool } from "../reader/read-worker-pool";
import { readConfig } from "./config";
import { createUpstreamHealth, createWorkerDiscovery } from "./feed-authority";

const first = {
  id: "first",
  token: "a".repeat(32),
  url: "https://first.example",
};
const second = {
  id: "second",
  token: "b".repeat(32),
  url: "https://second.example",
};

test("generator failures stay isolated and recovered upstream traffic expires old evidence", () => {
  let clock = 0;
  const upstream = createUpstreamHealth(() => clock);
  const rateLimited = {
    code: "rate_limited",
    durationMs: 10,
    outcome: "error",
  } as const;
  upstream.observe({ ...rateLimited, operation: "app.bsky.feed.getFeed" });
  upstream.observe({ ...rateLimited, operation: "app.bsky.feed.searchPosts" });
  expect(upstream.snapshot().limited).toBe(0);
  upstream.observe({ ...rateLimited, operation: "app.bsky.feed.getPosts" });
  expect(upstream.snapshot().limited).toBe(1);
  clock = 60_000;
  expect(upstream.snapshot().limited).toBe(0);
});

test("authenticated worker discovery updates read and hydration routing without restarting", async () => {
  let config: string | null = '["first"]';
  let rosterUnavailable = true;
  let draining = false;
  const fetcher = mock(async (input: URL, init?: RequestInit) => {
    const node = input.origin === first.url ? first : second;
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${node.token}`
    );
    expect(init?.redirect).toBe("error");
    await Promise.resolve();
    return Response.json(
      {
        id: node.id,
        ingestion: { storageReady: node === first },
        mode: "read-worker",
        version: "test",
      },
      { headers: { "x-asm-read-worker": "1" }, status: draining ? 503 : 200 }
    );
  });
  const discover = createWorkerDiscovery({
    configured: [first, second],
    fetch: fetcher,
    roster: {
      get: () =>
        rosterUnavailable
          ? Promise.reject(new Error("Roster unavailable"))
          : Promise.resolve(config),
    },
  });
  const beforeRosterRead = await discover();
  expect(beforeRosterRead.readNodes).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
  rosterUnavailable = false;
  const initial = await discover();
  expect(initial.hydrationNodes).toEqual(["first"]);
  expect(initial.readNodes).toEqual([first]);
  config = '["second"]';
  const changed = await discover();
  expect(changed.hydrationNodes).toEqual([]);
  expect(changed.readNodes).toEqual([second]);
  const read = mock(async (url: string) => {
    await Promise.resolve();
    return Response.json(
      { ok: true },
      {
        headers: { "x-asm-read-worker": "1" },
        status: url.startsWith(first.url) ? 503 : 200,
      }
    );
  });
  const pool = createReadWorkerPool({
    fetch: read,
    logger: { debug: mock(), error: mock(), info: mock(), warn: mock() },
    nodes: [first],
  });
  pool.updateNodes(changed.readNodes);
  const target =
    "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=did:plc:test";
  await pool.fetch(target, {});
  await pool.fetch(target, {});
  expect(read.mock.calls.some(([url]) => url.startsWith(second.url))).toBe(
    true
  );
  expect(read.mock.calls.some(([url]) => url.startsWith(first.url))).toBe(
    false
  );
  for (const invalid of [
    "{ broken",
    JSON.stringify([{ ...first, url: "https://unapproved.example" }]),
    '["first", "unapproved"]',
    '["first", "first"]',
    " ".repeat(1025),
  ]) {
    config = invalid;
    fetcher.mockClear();
    // oxlint-disable-next-line no-await-in-loop -- Each edit is applied to the same live roster.
    const retained = await discover();
    expect(retained.readNodes).toEqual([second]);
    expect(fetcher.mock.calls.map(([url]) => url.origin)).toEqual([second.url]);
  }
  config = "[]";
  fetcher.mockClear();
  const drained = await discover();
  expect(drained.readNodes).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
  rosterUnavailable = true;
  const unavailableWhileDrained = await discover();
  expect(unavailableWhileDrained.readNodes).toEqual([]);
  rosterUnavailable = false;
  config = null;
  const restored = await discover();
  expect(restored.readNodes).toEqual([first, second]);
  draining = true;
  const unavailable = await discover();
  expect(unavailable.readNodes).toEqual([]);
});

test("worker roster configuration requires a distinct endpoint and a dedicated reader", () => {
  const env = { REDIS_URL: "redis://shared:6379/5" };
  const valid = "rediss://asm_roster_reader:password@roster:6379/0";
  expect(
    readConfig({ ...env, PROTOCOLS_WORKER_ROSTER_REDIS_URL: valid })
      .workerRosterRedisUrl
  ).toBe(valid);
  for (const invalid of [
    "redis://shared",
    "redis://asm_roster_reader:password@shared",
    "redis://asm_roster_reader@roster",
    "redis://asm_roster_operator:password@roster",
    "redis://asm_roster_reader:password@roster/1",
    "https://asm_roster_reader:password@roster",
  ]) {
    expect(() =>
      readConfig({ ...env, PROTOCOLS_WORKER_ROSTER_REDIS_URL: invalid })
    ).toThrow("PROTOCOLS_WORKER_ROSTER_REDIS_URL");
  }
  expect(() =>
    readConfig({ PROTOCOLS_WORKER_ROSTER_REDIS_URL: valid })
  ).toThrow("requires REDIS_URL");
});
