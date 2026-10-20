import { beforeEach, expect, mock, test } from "bun:test";

let session: { user: { id: string } } | null = { user: { id: "reader" } };
const writes: unknown[] = [];
let reads = 0;
let available = true;
let offline = false;
let threadReplies: unknown[] = [];
const uri = "at://did:web:example.test/app.bsky.feed.post/example";
const post = {
  author: { id: "did:web:example.test" },
  id: uri,
  source: "bluesky",
};
class FixtureError extends Error {
  override name = "FixtureError";
}
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@/lib/protocols/budget", () => ({
  ProtocolBudgetError: FixtureError,
  consumeExternalCreationBudget: () => Promise.resolve(),
  consumeProtocolBudget: () => Promise.resolve(),
}));
mock.module("@/lib/protocols/service", () => ({
  readBlueskyPosts: () => {
    reads += 1;
    if (offline) {
      return Promise.reject(new Error("Source unavailable"));
    }
    return Promise.resolve(available ? [post] : []);
  },
  readBlueskyThread: () => {
    if (offline) {
      return Promise.reject(new Error("Source unavailable"));
    }
    return Promise.resolve({
      post: available ? post : null,
      replies: available ? threadReplies : [],
    });
  },
}));
mock.module("@asm/db", () => ({
  ExternalInteractionError: FixtureError,
  externalComments: () => Promise.resolve({ cursor: null, items: [] }),
  externalLibrary: () => Promise.resolve({ cursor: null, items: [] }),
  externalPostStates: () => Promise.resolve(new Map()),
  externalResponses: () => Promise.resolve({ cursor: null, items: [] }),
  findExternalPost: () => Promise.resolve(null),
  getClientIpFromHeaders: () => "127.0.0.1",
  getNetworkPersona: () => Promise.resolve({ selected: { id: "default" } }),
  getTrustedIngressIp: () => "127.0.0.1",
  hashViewerId: (value: string) => value,
  mutateExternalPost: (input: unknown) => {
    writes.push(input);
    return Promise.resolve({
      amplifications: 0,
      amplified: false,
      bookmarked: true,
      comments: 0,
    });
  },
  networkContentTopics: () => [],
  prisma: {
    orm: {
      public: {
        Accounts: {
          where: () => ({
            first: () => Promise.resolve(null),
          }),
        },
      },
    },
  },
  recordNetworkSignal: () => Promise.resolve(true),
  refreshExternalPost: () => Promise.resolve(),
  removeNetworkSignal: () => Promise.resolve(true),
}));
const { GET, POST } = await import("./route");
const request = (body: unknown, headers: HeadersInit = {}) =>
  new Request("http://localhost/api/protocols/bluesky/interactions", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
beforeEach(() => {
  session = { user: { id: "reader" } };
  writes.length = 0;
  reads = 0;
  available = true;
  offline = false;
  threadReplies = [];
});
test("guests may read discussions but cannot create durable data", async () => {
  session = null;
  const response = await POST(
    request({ action: "bookmark", active: true, uri })
  );
  expect(response.status).toBe(401);
  expect(reads).toBe(0);
  expect(writes).toEqual([]);
  const read = await GET(
    new Request(
      `http://localhost/api/protocols/bluesky/interactions?${new URLSearchParams({ uri })}`
    )
  );
  expect(read.status).toBe(200);
  expect(writes).toEqual([]);
});
test("forged snapshots and cross-origin writes never fetch or persist source content", async () => {
  const forged = await POST(
    request({ action: "bookmark", active: true, post: { text: "forged" }, uri })
  );
  const crossSite = await POST(
    request(
      { action: "bookmark", active: true, uri },
      { origin: "https://hostile.test" }
    )
  );
  expect(forged.status).toBe(400);
  expect(crossSite.status).toBe(403);
  expect(reads).toBe(0);
  expect(writes).toEqual([]);
});
test("first interactions retain only a server-fetched post and source removal blocks new interactions", async () => {
  const response = await POST(
    request({ action: "bookmark", active: true, uri })
  );
  expect(response.status).toBe(200);
  expect(writes[0]).toEqual({
    action: "bookmark",
    active: true,
    post,
    uri,
    userId: "reader",
  });
  available = false;
  const removed = await POST(request({ action: "amplify", active: true, uri }));
  expect(removed.status).toBe(410);
  expect(writes).toHaveLength(1);
});
test("removing a bookmark remains possible without contacting the source", async () => {
  available = false;
  const response = await POST(
    request({ action: "bookmark", active: false, uri })
  );
  expect(response.status).toBe(200);
  expect(reads).toBe(0);
});

test("a source outage returns a retryable failure instead of a successful deletion", async () => {
  offline = true;
  const response = await GET(
    new Request(
      `http://localhost/api/protocols/bluesky/interactions?${new URLSearchParams({ uri })}`
    )
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("2");
});

test("a verified source absence still renders the preserved discussion", async () => {
  available = false;
  const response = await GET(
    new Request(
      `http://localhost/api/protocols/bluesky/interactions?${new URLSearchParams({ uri })}`
    )
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    comments: { cursor: null, items: [] },
    post: null,
  });
});

test("discussion pagination never waits for or revalidates the upstream post", async () => {
  offline = true;
  session = null;
  const response = await GET(
    new Request(
      `http://localhost/api/protocols/bluesky/interactions?${new URLSearchParams({ kind: "comments", uri })}`
    )
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    comments: { cursor: null, items: [] },
  });
  expect(reads).toBe(0);
  expect(writes).toEqual([]);
});

test("discussion includes upstream Bluesky replies mapped as external comments with hierarchy", async () => {
  threadReplies = [
    {
      author: {
        displayName: "Bob",
        handle: "bob.bsky.social",
        id: "did:plc:bob",
        labels: [],
        source: "bluesky",
        upstreamCounts: {},
        url: "https://bsky.app/profile/did:plc:bob",
      },
      createdAt: "2026-10-16T12:00:00.000Z",
      id: `${uri}/reply-1`,
      indexedAt: "2026-10-16T12:00:00.000Z",
      labels: [],
      languages: [],
      media: [],
      replyTo: uri,
      revision: "rev",
      segments: [{ text: "Direct reply" }],
      source: "bluesky",
      text: "Direct reply",
      upstreamCounts: { likes: 0, replies: 0, reposts: 0 },
      url: "https://bsky.app/profile/did:plc:bob/post/reply-1",
    },
    {
      author: {
        displayName: "Charlie",
        handle: "charlie.bsky.social",
        id: "did:plc:charlie",
        labels: [],
        source: "bluesky",
        upstreamCounts: {},
        url: "https://bsky.app/profile/did:plc:charlie",
      },
      createdAt: "2026-10-16T12:05:00.000Z",
      id: `${uri}/reply-2`,
      indexedAt: "2026-10-16T12:05:00.000Z",
      labels: [],
      languages: [],
      media: [],
      replyTo: `${uri}/reply-1`,
      revision: "rev",
      segments: [{ text: "Nested reply" }],
      source: "bluesky",
      text: "Nested reply",
      upstreamCounts: { likes: 0, replies: 0, reposts: 0 },
      url: "https://bsky.app/profile/did:plc:charlie/post/reply-2",
    },
  ];
  const response = await GET(
    new Request(
      `http://localhost/api/protocols/bluesky/interactions?${new URLSearchParams({ kind: "comments", uri })}`
    )
  );
  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    comments: {
      items: {
        id: string;
        parentId: string | null;
        rootId: string | null;
        source: string;
        content: string;
      }[];
    };
  };
  expect(data.comments.items).toHaveLength(2);
  expect(data.comments.items[0]).toMatchObject({
    content: "Direct reply",
    id: `${uri}/reply-1`,
    parentId: null,
    rootId: uri,
    source: "bluesky",
  });
  expect(data.comments.items[1]).toMatchObject({
    content: "Nested reply",
    id: `${uri}/reply-2`,
    parentId: `${uri}/reply-1`,
    rootId: uri,
    source: "bluesky",
  });
});
