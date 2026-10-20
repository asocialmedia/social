// Network fixtures deliberately preserve asynchronous fetch behavior.
// oxlint-disable require-await, promise/avoid-new, unicorn/no-await-expression-member
import { expect, mock, test } from "bun:test";

import { BlueskyClient } from "@asm/protocols/bluesky";
import type { ProtocolDiagnostic } from "@asm/protocols/contracts";

import { readConfig } from "./config";
import { createReadWorkerApp } from "./read-worker";
import { publicReadTarget } from "./read-worker-policy";
import { createReadWorkerPool } from "./read-worker-pool";
import { createWorkerReader } from "./worker-reader";

const token = "read_worker_test_token_01234567890123456789";
const node = { id: "us-east", token, url: "https://worker.example" };
const profile =
  "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=did:plc:alice";
const search = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=hello";
const logger = () => ({
  debug: mock(),
  error: mock(),
  info: mock(),
  warn: mock(),
});
const response = (value: unknown, status = 200) =>
  Response.json(value, { headers: { "x-asm-read-worker": "1" }, status });
const request = (url: string, credential = token) =>
  new Request(
    `https://worker.example/v1/worker/read?${new URLSearchParams({ url })}`,
    { headers: { authorization: `Bearer ${credential}` } }
  );

test("read workers start without Redis and reject coordinator dependencies", () => {
  expect(
    readConfig({
      NODE_ENV: "production",
      PROTOCOLS_MODE: "read-worker",
      PROTOCOLS_WORKER_TOKEN: token,
    }).mode
  ).toBe("read-worker");
  expect(readConfig({}).workers).toEqual([]);
  for (const extra of [
    { PROTOCOLS_JETSTREAM_ENABLED: "true" },
    { PROTOCOLS_READ_WORKERS: JSON.stringify([node]) },
    { PROTOCOLS_WORKER_TOKEN: "short" },
  ]) {
    expect(() =>
      readConfig({
        PROTOCOLS_MODE: "read-worker",
        PROTOCOLS_WORKER_TOKEN: token,
        ...extra,
      })
    ).toThrow();
  }
  const background = readConfig({
    NODE_ENV: "production",
    PROTOCOLS_INGESTION_QUEUE_ENABLED: "true",
    PROTOCOLS_MODE: "read-worker",
    PROTOCOLS_WORKER_TOKEN: token,
    REDIS_URL: "redis://localhost",
  });
  expect(background.ingestionQueueEnabled).toBe(true);
  expect(() =>
    readConfig({ NODE_ENV: "production", PROTOCOLS_INTERNAL_TOKEN: token })
  ).toThrow("REDIS_URL");
});

test("node configuration rejects duplicate, insecure and credential-bearing origins without exposing secrets", () => {
  expect(
    readConfig({ PROTOCOLS_READ_WORKERS: JSON.stringify([node]) }).workers
  ).toEqual([node]);
  for (const value of [
    [node, node],
    [{ ...node, id: "local" }],
    [{ ...node, url: "http://worker.example" }],
    [{ ...node, url: "https://secret@worker.example" }],
    [{ ...node, url: "https://worker.example/path" }],
  ]) {
    expect(() =>
      readConfig({ PROTOCOLS_READ_WORKERS: JSON.stringify(value) })
    ).toThrow();
  }
  expect(() =>
    readConfig({ PROTOCOLS_READ_WORKERS: '{"secret":"exposed' })
  ).toThrow("must be valid JSON");
});

test.each([
  "http://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
  "https://public.api.bsky.app.evil.test/xrpc/app.bsky.actor.getProfile",
  "https://user:password@public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
  "https://public.api.bsky.app/xrpc/com.atproto.repo.createRecord",
  "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts",
  "https://127.0.0.1/xrpc/app.bsky.actor.getProfile",
  "https://public.api.bsky.app:444/xrpc/app.bsky.actor.getProfile",
  "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile#fragment",
  "file:///etc/passwd",
])("worker rejects unsafe target %s", (url) =>
  expect(publicReadTarget(url)).toBeUndefined()
);

test("worker authentication, operation allowlist and readiness never perform unauthorized network reads", async () => {
  const fetcher = mock(async () => response({ did: "did:plc:alice" }));
  const worker = createReadWorkerApp({
    fetch: fetcher,
    id: node.id,
    logger: logger(),
    token,
  });
  expect((await worker.app.handle(request(profile, "wrong"))).status).toBe(401);
  expect(
    (await worker.app.handle(request("https://localhost/private"))).status
  ).toBe(400);
  expect(
    (await worker.app.handle(new Request("https://worker.example/ready")))
      .status
  ).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  const result = await worker.app.handle(request(profile));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ did: "did:plc:alice" });
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(init.headers).has("authorization")).toBe(false);
  expect(init.redirect).toBe("error");
  worker.drain();
  expect((await worker.app.handle(request(profile))).status).toBe(503);
});

test("worker applies upstream host cooldown across callers while independent hosts keep serving", async () => {
  let now = 0;
  const fetcher = mock(async (url: string) =>
    url === profile
      ? Response.json(
          { error: "RateLimitExceeded" },
          { headers: { "retry-after": "45" }, status: 429 }
        )
      : response({ posts: [] })
  );
  const worker = createReadWorkerApp({
    fetch: fetcher,
    id: node.id,
    logger: logger(),
    now: () => now,
    token,
  });
  expect((await worker.app.handle(request(profile))).status).toBe(429);
  const paused = await worker.app.handle(request(profile));
  expect(paused.status).toBe(429);
  expect(paused.headers.get("retry-after")).toBe("45");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await worker.app.handle(request(search))).status).toBe(200);
  now = 46_000;
  await worker.app.handle(request(profile));
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("worker bounds concurrency and response bodies", async () => {
  let finish: ((value: Response) => void) | undefined;
  const worker = createReadWorkerApp({
    concurrency: 1,
    fetch: () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    id: node.id,
    logger: logger(),
    token,
  });
  const pending = worker.app.handle(request(profile));
  await Bun.sleep(5);
  expect((await worker.app.handle(request(profile))).status).toBe(503);
  finish?.(
    new Response("{}", {
      headers: { "content-length": String(3 * 1024 * 1024) },
    })
  );
  expect((await pending).status).toBe(502);
});

test("background hydration shares HTTP capacity, cooldowns and shutdown", async () => {
  const pending = Promise.withResolvers<Response>();
  const fetcher = mock(() => pending.promise);
  const worker = createReadWorkerApp({
    background: () => ({ permitted: true }),
    concurrency: 1,
    fetch: fetcher,
    id: node.id,
    logger: logger(),
    token,
  });
  const background = worker.fetch(profile, {});
  expect((await worker.app.handle(request(profile))).status).toBe(503);
  const ready = await worker.app.handle(
    new Request("https://worker.example/ready", {
      headers: { authorization: `Bearer ${token}` },
    })
  );
  expect(await ready.json()).toMatchObject({
    active: 1,
    ingestion: { permitted: true },
  });
  pending.resolve(
    Response.json({}, { headers: { "retry-after": "60" }, status: 429 })
  );
  expect((await background).status).toBe(429);
  expect((await worker.app.handle(request(profile))).status).toBe(429);
  expect(fetcher).toHaveBeenCalledTimes(1);
  worker.drain();
  expect((await worker.fetch(search, {})).status).toBe(503);
});

test("background transport rejects private operations and credentials", async () => {
  const fetcher = mock(() => Promise.resolve(response({})));
  const worker = createReadWorkerApp({
    fetch: fetcher,
    id: node.id,
    logger: logger(),
    token,
  });
  await Promise.all(
    [
      { method: "POST" },
      { body: "private" },
      { headers: { authorization: "Bearer private" } },
    ].map(async (init) => {
      expect((await worker.fetch(profile, init)).status).toBe(400);
    })
  );
  expect((await worker.fetch("https://localhost/private", {})).status).toBe(
    400
  );
  expect(fetcher).not.toHaveBeenCalled();
});

test("missing visibility declarations remain eligible without transport failure warnings", async () => {
  const logs = logger();
  const worker = createReadWorkerApp({
    fetch: () =>
      Promise.resolve(
        Response.json({ error: "RecordNotFound" }, { status: 400 })
      ),
    id: node.id,
    logger: logs,
    token,
  });
  const client = new BlueskyClient({ fetch: worker.fetch, maxRetries: 0 });
  try {
    expect(await client.allowsRecommendations("did:plc:alice")).toBe(true);
    expect(logs.warn).not.toHaveBeenCalled();
    expect(logs.debug).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success", status: 400 }),
      "Protocol upstream request completed"
    );
  } finally {
    client.close();
    worker.drain();
  }
});

test.each([
  {
    collection: "app.bsky.actor.profile",
    error: "RecordNotFound",
    status: 400,
  },
  {
    collection: "app.bsky.actor.contentVisibilityDeclaration",
    error: "InvalidRequest",
    status: 400,
  },
  {
    collection: "app.bsky.actor.contentVisibilityDeclaration",
    error: "RecordNotFound",
    status: 503,
  },
])(
  "unexpected record failures retain status in diagnostics: %j",
  async (failure) => {
    const diagnostics: ProtocolDiagnostic[] = [];
    const reader = createWorkerReader({
      fetch: () =>
        Promise.resolve(
          Response.json({ error: failure.error }, { status: failure.status })
        ),
      observe: (diagnostic) => diagnostics.push(diagnostic),
    });
    const url = `https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?${new URLSearchParams(
      {
        collection: failure.collection,
        repo: "did:plc:alice",
        rkey: "self",
      }
    )}`;
    expect((await reader.fetch(url, {})).status).toBe(failure.status);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "unavailable",
        outcome: "error",
        status: failure.status,
      }),
    ]);
    reader.drain();
  }
);

test("pool distributes unique reads between local and remote without forwarding upstream credentials", async () => {
  const calls: string[] = [];
  const pool = createReadWorkerPool({
    fetch: async (url, init) => {
      calls.push(url);
      const headers = new Headers(init.headers);
      if (url.startsWith(node.url)) {
        expect(headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(new URL(url).searchParams.get("url")).toBe(profile);
      } else {
        expect(headers.has("authorization")).toBe(false);
        expect(headers.has("cookie")).toBe(false);
      }
      return response({ ok: true });
    },
    logger: logger(),
    nodes: [node],
  });
  await pool.fetch(profile, { headers: { cookie: "private=secret" } });
  await pool.fetch(profile, {});
  expect(calls[0]).toBe(profile);
  expect(calls[1]?.startsWith(node.url)).toBe(true);
});

test.each(["fr-CA,fr;q=0.9,en;q=0.5", undefined])(
  "local, remote and background reads preserve language %s through the header allowlist",
  async (language) => {
    const upstreamHeaders: Headers[] = [];
    const upstream = async (_url: string, init: RequestInit) => {
      upstreamHeaders.push(new Headers(init.headers));
      return response({ feed: [] });
    };
    const worker = createReadWorkerApp({
      fetch: upstream,
      id: node.id,
      logger: logger(),
      token,
    });
    const pool = createReadWorkerPool({
      fetch: (url, init) =>
        url.startsWith(node.url)
          ? worker.app.handle(new Request(url, init))
          : upstream(url, init),
      logger: logger(),
      nodes: [node],
    });
    const headers = new Headers({
      cookie: "private=secret",
      "x-private-header": "secret",
    });
    if (language) {
      headers.set("accept-language", language);
    }
    const feed =
      "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:alice/app.bsky.feed.generator/example";
    expect((await pool.fetch(feed, { headers })).status).toBe(200);
    expect((await pool.fetch(feed, { headers })).status).toBe(200);
    expect((await worker.fetch(feed, { headers })).status).toBe(200);
    expect(upstreamHeaders).toHaveLength(3);
    for (const forwarded of upstreamHeaders) {
      expect(Object.fromEntries(forwarded)).toEqual({
        accept: "application/json",
        ...(language ? { "accept-language": language } : {}),
      });
    }
  }
);

test("one IP's 429 does not cool down healthy nodes or a different upstream host", async () => {
  const calls: string[] = [];
  const pool = createReadWorkerPool({
    fetch: async (url) => {
      calls.push(url);
      return url === profile
        ? Response.json({}, { headers: { "retry-after": "60" }, status: 429 })
        : response({ ok: true });
    },
    logger: logger(),
    nodes: [node],
    now: () => 0,
  });
  expect((await pool.fetch(profile, {})).status).toBe(200);
  expect((await pool.fetch(profile, {})).status).toBe(200);
  expect(calls.filter((url) => url === profile)).toHaveLength(1);
  expect((await pool.fetch(search, {})).status).toBe(200);
  expect(calls).toContain(search);
});

test.each(["offline", "old-image", "malformed", "oversized", "timeout"])(
  "pool falls back locally for a %s remote node and avoids it during cooldown",
  async (failure) => {
    const calls: string[] = [];
    const pool = createReadWorkerPool({
      fetch: async (url) => {
        calls.push(url);
        if (!url.startsWith(node.url)) {
          return response({ local: true });
        }
        if (failure === "offline") {
          throw new TypeError("offline");
        }
        if (failure === "old-image") {
          return Response.json({ wrong: true });
        }
        if (failure === "oversized") {
          return new Response("{}", {
            headers: { "content-length": "3000000", "x-asm-read-worker": "1" },
          });
        }
        if (failure === "timeout") {
          return new Promise<Response>(() => {});
        }
        return new Response("invalid json", {
          headers: { "x-asm-read-worker": "1" },
        });
      },
      logger: logger(),
      nodes: [node],
      timeoutMs: 20,
    });
    await pool.fetch(profile, {});
    expect(await (await pool.fetch(profile, {})).json()).toEqual({
      local: true,
    });
    await pool.fetch(profile, {});
    expect(calls.filter((url) => url.startsWith(node.url))).toHaveLength(1);
  }
);

test("pool honors caller cancellation without retrying another node", async () => {
  const abort = new AbortController();
  const fetcher = mock(async () => {
    abort.abort();
    throw new TypeError("cancelled");
  });
  const pool = createReadWorkerPool({
    fetch: fetcher,
    logger: logger(),
    nodes: [node],
  });
  await expect(pool.fetch(profile, { signal: abort.signal })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("removing every remote node leaves successful local reads and validation intact", async () => {
  const fetcher = mock(async (_url: string) =>
    response({
      did: "did:plc:alice",
      followersCount: 3,
      followsCount: 1,
      handle: "alice.bsky.social",
      postsCount: 2,
    })
  );
  const pool = createReadWorkerPool({
    fetch: fetcher,
    logger: logger(),
    nodes: [],
  });
  const client = new BlueskyClient({ fetch: pool.fetch, maxRetries: 0 });
  expect((await client.getProfile("did:plc:alice")).handle).toBe(
    "alice.bsky.social"
  );
  expect(
    new URL(
      fetcher.mock.calls[0]?.[0] ?? "https://missing.example"
    ).searchParams.get("actor")
  ).toBe("did:plc:alice");
  client.close();
});
