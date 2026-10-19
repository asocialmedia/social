import { expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

let limited = false;
mock.module("@/lib/search/guest-budget", () => ({
  guestSearchBudget: () =>
    Promise.resolve({
      headers: new Headers(),
      response: limited
        ? Response.json({ error: "Limited" }, { status: 429 })
        : null,
    }),
}));

const read = mock(
  (_query: string, _signal: AbortSignal, _requestId: string, _kind: string) =>
    Promise.resolve({ posts: [], profiles: [], unavailable: [] })
);
mock.module("@/lib/protocols/service", () => ({ readBlueskySearch: read }));
mock.module("@/lib/protocols/budget", () => ({
  ProtocolBudgetError: class extends Error {},
  consumeProtocolBudget: () => Promise.resolve(),
}));
mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  getClientIpFromHeaders: () => "127.0.0.1",
  getTrustedIngressIp: () => "127.0.0.1",
  hashViewerId: () => "search-guest",
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(null),
}));
const { GET } = await import("./route");

test("public search validates before reading, forwards cancellation, and remains private", async () => {
  await Promise.all(
    ["", "x", "x".repeat(81)].map(async (query) => {
      const response = await GET(
        new Request(`http://localhost/api/protocols/bluesky/search?q=${query}`)
      );
      expect(response.status).toBe(400);
    })
  );
  expect(read).not.toHaveBeenCalled();
  const request = new Request(
    "http://localhost/api/protocols/bluesky/search?q=%20astronomy%20"
  );
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(read).toHaveBeenCalledWith(
    "astronomy",
    request.signal,
    expect.any(String),
    "all"
  );
  expect(await response.json()).toEqual({
    posts: [],
    profiles: [],
    unavailable: [],
  });
});

test("guest admission rejects requests before upstream search", async () => {
  const before = read.mock.calls.length;
  limited = true;
  try {
    const response = await GET(
      new Request("http://localhost/api/protocols/bluesky/search?q=limited")
    );
    expect(response.status).toBe(429);
    expect(read.mock.calls.length).toBe(before);
  } finally {
    limited = false;
  }
});
