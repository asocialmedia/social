import { afterEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
let withholdMedia = false;
mock.module("@asm/db", () => ({
  filterExternalMediaSafety: <T>(posts: T[]) =>
    Promise.resolve(withholdMedia ? [] : posts),
  readNetworkPreferences: () => Promise.resolve(null),
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(null),
}));
class ProtocolGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number;
  constructor(status: number, code: string, retryAfter = 2) {
    super(code);
    this.name = "ProtocolGatewayError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
mock.module("./gateway", () => ({ ProtocolGatewayError }));
const { readBlueskyProfileResource, readBlueskyPosts } =
  await import("./service");
const originalFetch = globalThis.fetch;
const originalService = process.env.PROTOCOLS_SERVICE_URL;
const originalToken = process.env.PROTOCOLS_INTERNAL_TOKEN;
afterEach(() => {
  withholdMedia = false;
  globalThis.fetch = originalFetch;
  if (originalService === undefined) {
    delete process.env.PROTOCOLS_SERVICE_URL;
  } else {
    process.env.PROTOCOLS_SERVICE_URL = originalService;
  }
  if (originalToken === undefined) {
    delete process.env.PROTOCOLS_INTERNAL_TOKEN;
  } else {
    process.env.PROTOCOLS_INTERNAL_TOKEN = originalToken;
  }
});

test.each(["profile", "author-feed"] as const)(
  "%s preserves the source cooldown so automatic recovery waits until it can succeed",
  async (kind) => {
    process.env.PROTOCOLS_SERVICE_URL = "http://protocols.test";
    process.env.PROTOCOLS_INTERNAL_TOKEN = "test-fixture";
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: mock(() =>
        Promise.resolve(
          new Response(null, { headers: { "retry-after": "4" }, status: 503 })
        )
      ),
      writable: true,
    });
    await expect(
      readBlueskyProfileResource(
        kind,
        new URLSearchParams({ actor: "bsky.app" }),
        AbortSignal.timeout(1000),
        "test",
        false
      )
    ).rejects.toMatchObject({ retryAfter: 4, status: 503 });
  }
);

test("withheld media is retryable and confirmed source absence remains empty", async () => {
  process.env.PROTOCOLS_SERVICE_URL = "http://protocols.test";
  process.env.PROTOCOLS_INTERNAL_TOKEN = "test-fixture";
  const uri = "at://did:plc:author/app.bsky.feed.post/example";
  const post = {
    author: {
      displayName: "Author",
      handle: "author.bsky.social",
      id: "did:plc:author",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/did:plc:author",
    },
    createdAt: "2026-10-16T10:00:00.000Z",
    id: uri,
    indexedAt: "2026-10-16T10:00:00.000Z",
    labels: [],
    languages: ["en"],
    media: [],
    revision: "cid",
    segments: [{ text: "Existing original" }],
    source: "bluesky",
    text: "Existing original",
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    url: "https://bsky.app/profile/did:plc:author/post/example",
  };
  let present = true;
  globalThis.fetch = Object.assign(
    mock((url: string | URL | Request) => {
      expect(new URL(String(url)).searchParams.get("presence")).toBe("1");
      return Promise.resolve(Response.json(present ? [post] : []));
    }),
    { preconnect: originalFetch.preconnect }
  );
  withholdMedia = true;
  await expect(
    readBlueskyPosts([uri], undefined, "test", false, true)
  ).rejects.toMatchObject({ code: "media_assessment_pending", status: 503 });
  present = false;
  expect(await readBlueskyPosts([uri], undefined, "test", false, true)).toEqual(
    []
  );
});
