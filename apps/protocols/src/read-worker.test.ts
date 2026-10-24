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

test("one worker's search denial retries locally and leaves its profile capacity available", async () => {
  let remoteSearches = 0;
  let remoteProfiles = 0;
  const pool = createReadWorkerPool({
    fetch: async (raw) => {
      if (raw.startsWith(node.url)) {
        const upstream = new URL(raw).searchParams.get("url") ?? "";
        if (upstream.includes("searchPosts")) {
          remoteSearches += 1;
          return Response.json(
            { error: "Forbidden" },
            {
              headers: {
                "x-asm-read-worker": "1",
                "x-asm-upstream-status": "403",
              },
              status: 403,
            }
          );
        }
        remoteProfiles += 1;
      }
      return response({ posts: [] });
    },
    logger: logger(),
    nodes: [node],
  });
  await pool.fetch(profile, {});
  expect((await pool.fetch(search, {})).status).toBe(200);
  expect((await pool.fetch(search, {})).status).toBe(200);
  await pool.fetch(profile, {});
  expect(remoteSearches).toBe(1);
  expect(remoteProfiles).toBe(1);
});

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

test("a denied search cursor cannot cool down another topic or a fresh date window", async () => {
  const remote: string[] = [];
  const pool = createReadWorkerPool({
    fetch: async (raw) => {
      if (raw.startsWith(node.url)) {
        const upstream = new URL(raw).searchParams.get("url") ?? "";
        remote.push(upstream);
        if (upstream.includes("cursor=denied")) {
          return response({ error: "Forbidden" }, 403);
        }
      }
      return response({ posts: [] });
    },
    logger: logger(),
    nodes: [node],
  });
  await pool.fetch(profile, {});
  const denied = `${search}&cursor=denied`;
  await pool.fetch(denied, {});
  await pool.fetch(denied, {});
  await pool.fetch(`${search}&since=2026-10-23T00%3A00%3A00Z`, {});
  await pool.fetch(`${search}&since=2026-10-23T00%3A00%3A00Z`, {});
  expect(remote.filter((url) => url.includes("cursor=denied"))).toHaveLength(1);
  expect(remote.some((url) => url.includes("since="))).toBe(true);
});

test("non-JSON upstream denials stay restricted and a generator's 401 cannot disable unrelated worker capacity", async () => {
  const denied = createReadWorkerPool({
    fetch: async () => new Response("<html>Forbidden</html>", { status: 403 }),
    logger: logger(),
    nodes: [],
  });
  expect((await denied.fetch(search, {})).status).toBe(403);
  const fetcher = mock(async (url: string) =>
    url.startsWith(node.url)
      ? Response.json(
          { error: "AuthRequired" },
          {
            headers: {
              "x-asm-read-worker": "1",
              "x-asm-upstream-status": "401",
            },
            status: 401,
          }
        )
      : response({ did: "did:plc:alice" })
  );
  const pool = createReadWorkerPool({
    fetch: fetcher,
    logger: logger(),
    nodes: [node],
  });
  await pool.fetch(profile, {});
  const feed =
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:test/app.bsky.feed.generator/private";
  expect((await pool.fetch(feed, {})).status).toBe(401);
  expect(
    pool.status().find((entry) => entry.id === node.id)?.cooldowns[
      "https://public.api.bsky.app"
    ]
  ).toBeUndefined();
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

test("negotiated worker capacity errors preserve their retry delay through edge proxies", async () => {
  const worker = createReadWorkerApp({ id: node.id, logger: logger(), token });
  worker.drain();
  const negotiated = request(profile);
  negotiated.headers.set("x-asm-worker-envelope", "1");
  const result = await worker.app.handle(negotiated);
  expect(result.status).toBe(200);
  expect(result.headers.get("x-asm-upstream-status")).toBe("503");
  expect(result.headers.get("retry-after")).toBe("1");
  expect(await result.json()).toEqual({ error: "worker_busy" });
});

test("the pool respects short capacity retry delays instead of applying a long failure cooldown", async () => {
  let now = 0;
  const fetcher = mock(async () =>
    Response.json(
      { error: "busy" },
      { headers: { "retry-after": "1" }, status: 503 }
    )
  );
  const pool = createReadWorkerPool({
    fetch: fetcher,
    logger: logger(),
    nodes: [],
    now: () => now,
  });
  expect((await pool.fetch(profile, {})).headers.get("retry-after")).toBe("1");
  await pool.fetch(profile, {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  now = 1001;
  await pool.fetch(profile, {});
  expect(fetcher).toHaveBeenCalledTimes(2);
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
    fetch: (url) =>
      Promise.resolve(
        url.includes("app.bsky.actor.getProfile")
          ? Response.json({ did: "did:plc:alice", handle: "alice.test" })
          : Response.json({ error: "RecordNotFound" }, { status: 400 })
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

test("a broken feed does not pause healthy feeds or post hydration on the same upstream", async () => {
  const broken =
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:alice/app.bsky.feed.generator/broken";
  const healthy =
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:alice/app.bsky.feed.generator/healthy";
  const posts =
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at://did:plc:alice/app.bsky.feed.post/example";
  const calls: string[] = [];
  const pool = createReadWorkerPool({
    fetch: async (url) => {
      calls.push(url);
      return url === broken
        ? Response.json({ error: "UpstreamFailure" }, { status: 502 })
        : Response.json({ posts: [] });
    },
    logger: logger(),
    nodes: [],
    now: () => 0,
  });
  expect((await pool.fetch(broken, {})).status).toBe(502);
  expect((await pool.fetch(healthy, {})).status).toBe(200);
  expect((await pool.fetch(posts, {})).status).toBe(200);
  expect((await pool.fetch(broken, {})).status).toBe(503);
  expect(calls).toEqual([broken, healthy, posts]);
});

test("worker upstream failures survive edge error interception without poisoning unrelated reads", async () => {
  const upstream =
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:alice/app.bsky.feed.generator/broken";
  const worker = createReadWorkerApp({
    fetch: async () =>
      Response.json({ error: "UpstreamFailure" }, { status: 502 }),
    id: node.id,
    logger: logger(),
    token,
  });
  const negotiated = request(upstream);
  negotiated.headers.set("x-asm-worker-envelope", "1");
  const envelope = await worker.app.handle(negotiated);
  expect(envelope.status).toBe(200);
  expect(envelope.headers.get("x-asm-upstream-status")).toBe("502");
  expect(await envelope.json()).toEqual({ error: "UpstreamFailure" });
  expect((await worker.app.handle(request(upstream))).status).toBe(502);
  const pool = createReadWorkerPool({
    fetch: async (url, init) =>
      url.startsWith(node.url)
        ? worker.app.handle(new Request(url, init))
        : Response.json({ error: "UpstreamFailure" }, { status: 502 }),
    logger: logger(),
    nodes: [node],
  });
  const result = await pool.fetch(upstream, {});
  expect(result.status).toBe(502);
  expect(await result.json()).toEqual({ error: "UpstreamFailure" });
  worker.drain();
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

const publicFeed = (name: string) =>
  `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:test/app.bsky.feed.generator/${name}`;

test("a failed worker operation cools down across distinct feeds while another operation remains available", async () => {
  const remote: string[] = [];
  const pool = createReadWorkerPool({
    fetch: async (url) => {
      if (url.startsWith(node.url)) {
        const upstream = new URL(url).searchParams.get("url") ?? "";
        remote.push(upstream);
        if (upstream.includes("getFeed?")) {
          throw new TypeError("worker transport unavailable");
        }
      }
      return response({ feed: [] });
    },
    logger: logger(),
    nodes: [node],
    now: () => 0,
  });
  await pool.fetch(profile, {});
  expect((await pool.fetch(publicFeed("first"), {})).status).toBe(200);
  expect((await pool.fetch(publicFeed("second"), {})).status).toBe(200);
  await pool.fetch(profile, {});
  await pool.fetch(profile, {});
  expect(remote.filter((url) => url.includes("getFeed?"))).toHaveLength(1);
  expect(remote.some((url) => url.includes("getProfile?"))).toBe(true);
});

test("three remote transport failures pause every operation on that origin until cooldown expires", async () => {
  let now = 0;
  const remote: string[] = [];
  const pool = createReadWorkerPool({
    fetch: async (url) => {
      if (url.startsWith(node.url)) {
        remote.push(new URL(url).searchParams.get("url") ?? "");
        throw new TypeError("worker offline");
      }
      return response({ ok: true });
    },
    logger: logger(),
    nodes: [node],
    now: () => now,
  });
  await pool.fetch(profile, {});
  const root = "https://public.api.bsky.app/xrpc/";
  await pool.fetch(profile, {});
  await pool.fetch(
    `${root}app.bsky.feed.getPosts?uris=at://did:plc:test/app.bsky.feed.post/one`,
    {}
  );
  await pool.fetch(publicFeed("first"), {});
  expect(remote).toHaveLength(3);
  const authorFeed = `${root}app.bsky.feed.getAuthorFeed?actor=did:plc:alice`;
  await pool.fetch(authorFeed, {});
  expect(remote).toHaveLength(3);
  now = 30_001;
  await pool.fetch(authorFeed, {});
  expect(remote).toHaveLength(4);
});

test("repeated operation failures back off despite healthy peers and allow only one recovery probe", async () => {
  let now = 0;
  const remote: string[] = [];
  let pending: ReturnType<typeof Promise.withResolvers<Response>> | undefined;
  let healthy = false;
  const pool = createReadWorkerPool({
    fetch: async (url) => {
      if (url.startsWith(node.url)) {
        const upstream = new URL(url).searchParams.get("url") ?? "";
        remote.push(upstream);
        if (upstream.includes("getFeed?")) {
          if (pending) {
            return pending.promise;
          }
          if (!healthy) {
            throw new TypeError("slow feed operation");
          }
        }
      }
      return response({ ok: true });
    },
    logger: logger(),
    nodes: [node],
    now: () => now,
  });
  const feedCalls = () =>
    remote.filter((url) => url.includes("getFeed?")).length;
  await pool.fetch(profile, {});
  await pool.fetch(publicFeed("first"), {});
  expect(feedCalls()).toBe(1);
  now = 10_001;
  await pool.fetch(profile, {});
  await pool.fetch(publicFeed("second"), {});
  await pool.fetch(publicFeed("second-peer"), {});
  expect(feedCalls()).toBe(2);
  expect(
    pool.status().find((entry) => entry.id === node.id)?.cooldowns[
      "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed"
    ]
  ).toBe(30_001);
  now = 20_002;
  await pool.fetch(publicFeed("third"), {});
  expect(feedCalls()).toBe(2);
  now = 30_002;
  pending = Promise.withResolvers<Response>();
  await pool.fetch(profile, {});
  const recovery = Promise.all([
    pool.fetch(publicFeed("recover"), {}),
    pool.fetch(publicFeed("recover-peer"), {}),
  ]);
  await Bun.sleep(1);
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      pool.fetch(publicFeed(`burst-${index}`), {})
    )
  );
  expect(feedCalls()).toBe(3);
  pending.resolve(response({ ok: true }));
  await recovery;
  pending = undefined;
  healthy = true;
  await pool.fetch(publicFeed("healthy"), {});
  await pool.fetch(publicFeed("healthy-2"), {});
  expect(feedCalls()).toBeGreaterThan(3);
});

test("a hanging remote-first attempt reserves enough of the caller deadline for local fallback", async () => {
  let primed = false;
  const order: string[] = [];
  const pool = createReadWorkerPool({
    fetch: async (url, init) => {
      if (url.startsWith(node.url)) {
        order.push("remote");
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
        });
      }
      if (!primed) {
        primed = true;
        return response({ primed: true });
      }
      order.push("local");
      await Bun.sleep(900);
      return response({ fallback: true });
    },
    localReserveMs: 1300,
    logger: logger(),
    nodes: [node],
    requestTimeoutMs: 2500,
    timeoutMs: 1800,
  });
  await pool.fetch(profile, {});
  const result = await pool.fetch(publicFeed("reserved"), {
    signal: AbortSignal.timeout(2500),
  });
  expect(await result.json()).toEqual({ fallback: true });
  expect(order).toEqual(["remote", "local"]);
});

test("a remote fallback retains its configured timeout when local capacity rejects immediately", async () => {
  const pool = createReadWorkerPool({
    fetch: async (url) => {
      if (url.startsWith(node.url)) {
        await Bun.sleep(1400);
        return response({ remote: true });
      }
      return response({ error: "RateLimited" }, 429);
    },
    localReserveMs: 1300,
    logger: logger(),
    nodes: [node],
    requestTimeoutMs: 2500,
    timeoutMs: 1800,
  });
  const result = await pool.fetch(profile, {
    signal: AbortSignal.timeout(2500),
  });
  expect(await result.json()).toEqual({ remote: true });
});

test("a remote-first failure uses reserved local capacity before a second remote node", async () => {
  const order: string[] = [];
  const pool = createReadWorkerPool({
    fetch: async (url) => {
      order.push(url);
      if (url.startsWith(node.url)) {
        throw new TypeError("offline");
      }
      return response({ ok: true });
    },
    logger: logger(),
    nodes: [node, { ...node, id: "other", url: "https://other.example" }],
  });
  await pool.fetch(profile, {});
  await pool.fetch(publicFeed("fallback"), {});
  expect(order).toHaveLength(3);
  expect(order[1]?.startsWith(node.url)).toBe(true);
  expect(order[2]).toBe(publicFeed("fallback"));
});
