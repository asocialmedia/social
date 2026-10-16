import { beforeEach, expect, mock, test } from "bun:test";

let session: { user: { id: string } } | null = { user: { id: "reader" } };
const writes: unknown[] = [];
let reads = 0;
let available = true;
let offline = false;
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
}));
mock.module("@asm/db", () => ({
  ExternalInteractionError: FixtureError,
  externalComments: () => Promise.resolve({ cursor: null, items: [] }),
  externalLibrary: () => Promise.resolve({ cursor: null, items: [] }),
  externalPostStates: () => Promise.resolve(new Map()),
  externalResponses: () => Promise.resolve({ cursor: null, items: [] }),
  findExternalPost: () => Promise.resolve(null),
  getClientIpFromHeaders: () => "127.0.0.1",
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
  refreshExternalPost: () => Promise.resolve(),
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

test("a source outage keeps ASM discussions readable and does not declare a deletion", async () => {
  offline = true;
  const response = await GET(
    new Request(
      `http://localhost/api/protocols/bluesky/interactions?${new URLSearchParams({ uri })}`
    )
  );
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.post).toBeNull();
  expect(result.comments).toEqual({ cursor: null, items: [] });
});
