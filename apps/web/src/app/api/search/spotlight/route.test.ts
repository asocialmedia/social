import { expect, mock, test } from "bun:test";

const calls = { communities: 0, posts: 0, users: 0 };
let fail = false;
let limited = false;
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(null),
}));
mock.module("@/lib/search/guest-budget", () => ({
  guestSearchBudget: () =>
    Promise.resolve({
      headers: new Headers({ "cache-control": "private, no-store" }),
      response: limited
        ? Response.json({ error: "Limited" }, { status: 429 })
        : null,
    }),
}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
mock.module("@asm/db", () => ({
  readNetworkPreferences: () =>
    Promise.resolve({ preferences: { showExplicitContent: false } }),
  redis: {
    eval: () => Promise.resolve(1),
    get: () => Promise.reject(new Error("Redis offline")),
    set: () => Promise.resolve("OK"),
  },
  searchCommunitiesForSearch: () => {
    calls.communities += 1;
    return Promise.resolve([{ id: "community" }]);
  },
  searchPosts: () => {
    calls.posts += 1;
    return fail
      ? Promise.reject(new Error("DB unavailable"))
      : Promise.resolve([{ id: "post" }]);
  },
  searchUsers: () => {
    calls.users += 1;
    return Promise.resolve([{ id: "user" }]);
  },
}));
const { GET } = await import("./route");

test("native spotlight coalesces 1000 same-query requests and caches public results", async () => {
  const responses = await Promise.all(
    Array.from({ length: 1000 }, () =>
      GET(new Request("http://localhost/api/search/spotlight?q=software"))
    )
  );
  expect(responses.every((response) => response.status === 200)).toBe(true);
  expect(calls).toEqual({ communities: 1, posts: 1, users: 1 });
  const response = await GET(
    new Request("http://localhost/api/search/spotlight?q=SOFTWARE")
  );
  expect(await response.json()).toEqual({
    communities: [{ id: "community" }],
    posts: [{ id: "post" }],
    users: [{ id: "user" }],
  });
  // Cache hit does not hit DB
  expect(calls).toEqual({ communities: 1, posts: 1, users: 1 });
});

test("transient database outages report 503 so caller can fall back or retry", async () => {
  fail = true;
  try {
    const response = await GET(
      new Request("http://localhost/api/search/spotlight?q=outage-test")
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Search is temporarily unavailable.",
    });
  } finally {
    fail = false;
  }
});

test("guest quota exhaustion returns 429", async () => {
  limited = true;
  try {
    const response = await GET(
      new Request("http://localhost/api/search/spotlight?q=budget-exhausted")
    );
    expect(response.status).toBe(429);
  } finally {
    limited = false;
  }
});
