import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

let limited = false;
const read = mock(
  (
    _kind: string,
    _query: URLSearchParams,
    _signal: AbortSignal,
    _id: string,
    _explicit: boolean
  ) =>
    Promise.resolve({ cursor: "next-source-page", items: [] as ExternalPost[] })
);
mock.module("@/lib/protocols/service", () => ({
  readBlueskyProfileResource: read,
}));
mock.module("@/lib/search/guest-budget", () => ({
  guestSearchBudget: () =>
    Promise.resolve({
      headers: new Headers(),
      response: limited
        ? Response.json({ error: "Limited" }, { status: 429 })
        : null,
    }),
}));
mock.module("@/lib/protocols/budget", () => ({
  ProtocolBudgetError: class extends Error {},
  consumeProtocolBudget: () => Promise.resolve(),
}));
mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  getClientIpFromHeaders: () => "127.0.0.1",
  getTrustedIngressIp: () => "127.0.0.1",
  hashViewerId: () => "hashtag-guest",
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(null),
}));
const { GET } = await import("./route");

test("hashtag API normalizes the source filter and keeps filtered continuation private", async () => {
  const invalid = await GET(
    new Request("http://localhost/api/protocols/bluesky/hashtag?tag=bad%2Fpath")
  );
  expect(invalid.status).toBe(400);
  expect(read).not.toHaveBeenCalled();
  const response = await GET(
    new Request(
      "http://localhost/api/protocols/bluesky/hashtag?tag=OnePiece&cursor=page-two"
    )
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    cursor: "next-source-page",
    items: [],
  });
  const [args] = read.mock.calls;
  expect(args?.[0]).toBe("hashtag");
  expect(args?.[1].get("tag")).toBe("onepiece");
  expect(args?.[1].get("cursor")).toBe("page-two");
});

test("hashtag API applies guest admission before calling the source", async () => {
  limited = true;
  const before = read.mock.calls.length;
  try {
    const response = await GET(
      new Request("http://localhost/api/protocols/bluesky/hashtag?tag=onepiece")
    );
    expect(response.status).toBe(429);
    expect(read.mock.calls.length).toBe(before);
  } finally {
    limited = false;
  }
});
