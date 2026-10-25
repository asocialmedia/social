import { beforeEach, expect, mock, test } from "bun:test";

import { profileActivityCursorSchema } from "@/lib/protocols/profile-activity-schema";

let signedIn = true;
const reads: unknown[][] = [];
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(signedIn ? { user: { id: "viewer" } } : null),
}));
mock.module("@/lib/protocols/profile-activity", () => ({
  profileActivityCursorSchema,
  profileExternalActivity: (...args: unknown[]) => {
    reads.push(args);
    return Promise.resolve({ items: [], nextCursor: null });
  },
}));
const { GET } = await import("./route");
const context = { params: Promise.resolve({ userId: "profile-owner" }) };
beforeEach(() => {
  signedIn = true;
  reads.length = 0;
});

test("external profile activity uses the requested profile and the current reader separately", async () => {
  const response = await GET(
    new Request("http://localhost/activity?kind=amplified"),
    context
  );
  expect(response.status).toBe(200);
  expect(reads[0]?.slice(0, 3)).toEqual([
    "profile-owner",
    "viewer",
    "amplified",
  ]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test.each([
  "kind=bookmarks",
  "kind=eddies&cursor=bad-json",
  `kind=amplified&cursor=${encodeURIComponent(
    JSON.stringify({ at: "invalid", id: "record" })
  )}`,
])("invalid profile activity requests cannot read data: %s", async (query) => {
  const response = await GET(
    new Request(`http://localhost/activity?${query}`),
    context
  );
  expect(response.status).toBe(400);
  expect(reads).toHaveLength(0);
});

test("guests cannot read authenticated profile interaction data", async () => {
  signedIn = false;
  const response = await GET(
    new Request("http://localhost/activity?kind=eddies"),
    context
  );
  expect(response.status).toBe(401);
  expect(reads).toHaveLength(0);
});
