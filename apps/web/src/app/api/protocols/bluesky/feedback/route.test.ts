import { beforeEach, expect, mock, test } from "bun:test";

let session: { user: { id: string } } | null = { user: { id: "reader" } };
let fails = false;
const writes: unknown[][] = [];
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@/lib/protocols/feedback", () => ({
  writeExternalFeedback: (...args: unknown[]) => {
    writes.push(args);
    return fails
      ? Promise.reject(new Error("private Redis connection details"))
      : Promise.resolve();
  },
}));
mock.module("@/lib/protocols/budget", () => ({
  ProtocolBudgetError: class extends Error {},
  consumeProtocolBudget: () => Promise.resolve(),
}));
const { POST, DELETE } = await import("./route");
const feedback = {
  authorId: "did:plc:alice",
  postId: "at://did:plc:alice/app.bsky.feed.post/abc",
  scope: "post",
};
const request = (body: unknown) =>
  new Request("http://localhost/api/protocols/bluesky/feedback", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

beforeEach(() => {
  session = { user: { id: "reader" } };
  fails = false;
  writes.length = 0;
});

test("guest feedback never writes account preferences", async () => {
  session = null;
  const response = await POST(request(feedback));
  expect(response.status).toBe(401);
  expect(writes).toEqual([]);
});

test("valid feedback saves just the identity and Undo removes the same signal", async () => {
  const response = await POST(request(feedback));
  const undone = await DELETE(request(feedback));
  expect(response.status).toBe(200);
  expect(undone.status).toBe(200);
  expect(writes).toEqual([
    ["reader", feedback, false],
    ["reader", feedback, true],
  ]);
});

test("a post cannot be used to mute a different author or native identity", async () => {
  const wrongAuthor = await POST(
    request({ ...feedback, authorId: "did:plc:someoneelse", scope: "author" })
  );
  const native = await POST(request({ ...feedback, postId: "native-post" }));
  expect(wrongAuthor.status).toBe(400);
  expect(native.status).toBe(400);
  expect(writes).toEqual([]);
});

test("failed preference writes remain retryable and never leak internals", async () => {
  fails = true;
  const response = await POST(request(feedback));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("Redis");
});

test("cross-site writes and oversized bodies never reach preference storage", async () => {
  const crossSite = request(feedback);
  crossSite.headers.set("origin", "https://hostile.example");
  const response1 = await POST(crossSite);
  expect(response1.status).toBe(403);
  const oversized = await POST(
    request({ ...feedback, payload: "x".repeat(3000) })
  );
  expect(oversized.status).toBe(400);
  expect(writes).toEqual([]);
});

test("all responses carry private cache policy and a safe request identifier", async () => {
  const input = request(feedback);
  input.headers.set("x-request-id", "<unsafe>");
  const response = await POST(input);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9-]+$/);
});
