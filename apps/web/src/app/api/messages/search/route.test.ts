import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_USER_SEARCH_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";

import { GET } from "./route";

// The user search behind the "new message" recipient picker. It is the most
// expensive read on the messaging surface - two unanchored ILIKE scans over users,
// one per name field, and a leading wildcard cannot use a btree index - and it
// fires per keystroke.

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));

const mockAll = mock((_columns: string[]) => [] as unknown[]);
let scanned: unknown[] = [];

// Every query the route issues, in order. The route makes two parallel scans, so
// this records them as they are composed rather than as they resolve.
const recordScan = (columns: string[]) => {
  scanned.push(columns);
  const builder = {
    all: () => Promise.resolve(mockAll(columns)),
    include: () => ({
      limit: () => ({ all: () => Promise.resolve(mockAll(columns)) }),
    }),
    limit: () => ({ all: () => Promise.resolve(mockAll(columns)) }),
    where: () => builder,
  };
  return builder;
};

// The limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  SYSTEM_MODERATION_USER_ID: "system",
  and: (...conditions: unknown[]) =>
    Object.assign({}, ...(conditions.filter(Boolean) as object[])),
  prisma: {
    orm: {
      public: {
        Users: {
          select: (columns: string[]) => recordScan(columns),
        },
      },
    },
  },
}));

function search(query: string) {
  const url = new URL("http://localhost/api/messages/search");
  if (query) {
    url.searchParams.set("q", query);
  }
  return GET(new Request(url));
}

beforeEach(() => {
  mockGetSession.mockClear();
  mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
  mockAll.mockClear();
  mockAll.mockImplementation(() => []);
  scanned = [];
  limiter.reset();
});

describe("GET /api/messages/search", () => {
  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await search("haze");
    expect(res.status).toBe(401);
    expect(limiter.chargedBuckets).toEqual([]);
  });

  test("an empty query is free", async () => {
    // The typeahead issues this on every render of the field. It costs nothing,
    // so it must not cost a budget either, or opening the picker would spend the
    // same allowance a real search does.
    const res = await search("");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: [] });
    expect(limiter.chargedBuckets).toEqual([]);
    expect(scanned).toEqual([]);
  });

  test("a non-empty query runs both name scans", async () => {
    const res = await search("haze");
    expect(res.status).toBe(200);
    expect(scanned).toHaveLength(2);
    // Both scan for the caller's follows only, and neither returns the system
    // moderator account.
    expect(await res.json()).toEqual({ users: [] });
  });
});

describe("GET /api/messages/search rate limit", () => {
  test("spends the search budget, per account", async () => {
    const res = await search("haze");
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([DEN_USER_SEARCH_RATE_LIMIT.bucket]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
  });

  test("429s with a retry-after and runs neither scan when over budget", async () => {
    // Two full-table ILIKE scans are the most expensive thing an authenticated
    // caller can do with a GET here, and they happen per keystroke. A refusal
    // after them would be a refusal that already cost the database the work.
    limiter.setDenied(true);
    const res = await search("haze");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(scanned).toEqual([]);
  });

  test("charges the limiter before it issues a query", async () => {
    await search("haze");
    expect(limiter.order[0]).toBe(
      `consume:${DEN_USER_SEARCH_RATE_LIMIT.bucket}`
    );
    expect(scanned).toHaveLength(2);
  });

  test("two accounts do not share one budget", async () => {
    await search("haze");
    mockGetSession.mockImplementation(() => ({ user: { id: "user2" } }));
    await search("haze");
    expect(limiter.chargedIdentifiers).toEqual(["user1", "user2"]);
  });

  test("matches the community search bucket at the same number", () => {
    // Both are per-keystroke unanchored scans over a wide table, and the
    // community route has run at sixty a minute since before this one existed.
    // Keeping them the same number means one honest answer to "how much
    // searching is allowed", and the comment here names the reason rather than
    // leaving the coincidence looking deliberate.
    expect(DEN_USER_SEARCH_RATE_LIMIT.limit).toBe(60);
    expect(DEN_USER_SEARCH_RATE_LIMIT.windowSeconds).toBe(60);
  });

  test("the budget slides, so a typeahead cannot burst across a boundary", () => {
    // A typeahead is exactly the shape a fixed window suits badly: a burst of
    // suggestions as the user types quickly, then a pause, then another burst.
    expect(DEN_USER_SEARCH_RATE_LIMIT.window).toBe("sliding");
  });
});
