// oxlint-disable unicorn/no-await-expression-member -- These assertions inspect HTTP responses directly.
import { beforeEach, expect, mock, test } from "bun:test";

let session: { user: { id: string } } | null = { user: { id: "reader" } };
let following = false;
let offline = false;
const writes: unknown[][] = [];
let reads = 0;
const did = "did:web:example.test";
const author = {
  displayName: "Example",
  handle: "example.test",
  id: did,
  labels: [],
  source: "bluesky",
  upstreamCounts: {},
  url: "https://bsky.app/profile/example.test",
};
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@asm/db", () => ({
  ExternalFollowError: SyntaxError,
  externalFollowAuthors: () => Promise.resolve([author]),
  externalFollowState: () => Promise.resolve(following),
  getClientIpFromHeaders: () => "127.0.0.1",
  getTrustedIngressIp: () => "127.0.0.1",
  hashViewerId: () => "ip",
  redis: {
    publish: () => Promise.resolve(0),
    set: () => Promise.resolve("OK"),
  },
  setExternalFollow: (...args: unknown[]) => {
    writes.push(args);
    return Promise.resolve(args[2]);
  },
}));
mock.module("@/lib/protocols/service", () => ({
  readBlueskyProfileResource: () => {
    reads += 1;
    return offline
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(author);
  },
  verifyBlueskyFollowTarget: () => {
    reads += 1;
    return offline ? Promise.reject(new Error("offline")) : Promise.resolve();
  },
}));
mock.module("@/lib/protocols/budget", () => ({
  ProtocolBudgetError: class extends Error {},
  consumeProtocolBudget: () => Promise.resolve(),
}));
const { GET, POST } = await import("./route");
const request = (body: unknown) =>
  new Request("http://localhost/api/protocols/bluesky/follows", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
beforeEach(() => {
  session = { user: { id: "reader" } };
  following = false;
  offline = false;
  writes.length = 0;
  reads = 0;
});

test("ASM sign-in is required for follows, but linking a Bluesky account is not", async () => {
  const response = await POST(request({ active: true, actor: did }));
  expect(response.status).toBe(200);
  expect(writes).toEqual([["reader", did, true, author]]);
  expect(reads).toBe(2);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  session = null;
  writes.length = 0;
  expect((await POST(request({ active: true, actor: did }))).status).toBe(401);
  expect(writes).toEqual([]);
  expect(
    (await GET(new Request("http://localhost/api/protocols/bluesky/follows")))
      .status
  ).toBe(401);
});

test("unfollow and duplicate follows succeed during upstream outages", async () => {
  offline = true;
  expect((await POST(request({ active: false, actor: did }))).status).toBe(200);
  following = true;
  expect((await POST(request({ active: true, actor: did }))).status).toBe(200);
  expect(reads).toBe(0);
});

test("failed verification never creates a reference, and invalid or cross-site writes are rejected", async () => {
  offline = true;
  expect((await POST(request({ active: true, actor: did }))).status).toBe(503);
  expect(
    (await POST(request({ active: true, actor: "https://evil.test" }))).status
  ).toBe(400);
  const cross = request({ active: true, actor: did });
  cross.headers.set("origin", "https://evil.test");
  expect((await POST(cross)).status).toBe(403);
  expect(writes).toEqual([]);
});
