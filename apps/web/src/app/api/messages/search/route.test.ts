import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GROUP_ADD_REFUSAL_COPY } from "@asm/db/messages/dens";

import { GET } from "./route";

// Two searches, one route.
//
// The default context asks "who do I message" and is follow-only, which is the
// share sheet's question and not this change's. The den context asks "who exists
// and may I add them", which has to reach past the viewer's own follows and then
// narrow per candidate - a picker that only returned addable people could not show
// the reader that somebody they searched for said no.

type Predicate = (value: unknown) => unknown;

let viewerId = "viewer";
// Candidates returned by name, with the two signals the route reports.
let candidates: {
  followsViewer: boolean;
  groupAddPolicy: "EVERYONE" | "FOLLOWING_ONLY" | "NO_DIRECT_ADDS";
  hasIdentity: boolean;
  id: string;
  username: string;
}[] = [];

let lastPredicate: Predicate | null = null;

// Runs a recorded predicate against per-column recording accessors, so the mock
// answers from the constraints the query actually expressed rather than from a
// guess about which branch asked.
function probeWhere(predicate: unknown): Record<string, unknown> {
  const seen: Record<string, unknown> = {};
  const accessorFor = (column: string) => ({
    asc: () => "asc",
    desc: () => "desc",
    eq: (value: unknown) => {
      seen[column] = value;
      return {};
    },
    ilike: (value: unknown) => {
      seen[`${column}:ilike`] = value;
      return {};
    },
    in: (value: unknown) => {
      seen[column] = value;
      return {};
    },
    isNull: () => ({}),
    notIn: (value: unknown) => {
      seen[`${column}:notIn`] = value;
      return {};
    },
  });
  (predicate as (value: unknown) => unknown)({
    displayName: accessorFor("displayName"),
    followsFollows: {
      some: (inner: unknown) => {
        const nested: Record<string, unknown> = {};
        (inner as (value: unknown) => unknown)({
          followerId: {
            eq: (value: unknown) => {
              nested.followerId = value;
              return {};
            },
          },
        });
        seen.followedBy = nested.followerId;
        return {};
      },
    },
    id: accessorFor("id"),
    username: accessorFor("username"),
  });
  return seen;
}

function matches(seen: Record<string, unknown>): typeof candidates {
  const pattern = seen["username:ilike"];
  if (typeof pattern !== "string") {
    return candidates;
  }
  const needle = pattern.replaceAll(/^%|%$/g, "").toLowerCase();
  return candidates.filter((row) =>
    row.username.toLowerCase().includes(needle)
  );
}

const mockGetSession = mock(() => ({
  user: { id: "viewer" },
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/den-rate-limit", () => ({
  DEN_USER_SEARCH_RATE_LIMIT: { bucket: "den-user-search", limit: 30 },
  consumeDenRateLimit: () => Promise.resolve(null),
}));

mock.module("@asm/db", () => ({
  SYSTEM_MODERATION_USER_ID: "sys-zeph",
  and: (...conditions: unknown[]) => conditions,
  groupAddRefusal: (
    policy: "EVERYONE" | "FOLLOWING_ONLY" | "NO_DIRECT_ADDS",
    candidateFollowsActor: boolean
  ) => {
    if (policy === "EVERYONE") {
      return null;
    }
    if (policy === "NO_DIRECT_ADDS") {
      return "NO_DIRECT_ADDS";
    }
    return candidateFollowsActor ? null : "NOT_FOLLOWING_YOU";
  },
  or: (...conditions: unknown[]) => conditions,
  prisma: {
    orm: {
      public: {
        Users: {
          select: () => {
            const builder = {
              all: () => {
                const seen = probeWhere(lastPredicate);
                // The message context filters in the query itself; the den
                // context does not, because its narrowing is per row.
                const followerOnly = seen.followedBy === viewerId;
                return matches(seen)
                  .filter((row) => !followerOnly || row.followsViewer)
                  .map((row) => ({
                    avatarUrl: null,
                    badge: null,
                    badges: [],
                    displayName: row.username,
                    followsFollows: row.followsViewer
                      ? [{ followerId: viewerId }]
                      : [],
                    groupAddPolicy: row.groupAddPolicy,
                    id: row.id,
                    messageIdentities: row.hasIdentity
                      ? { userId: row.id }
                      : null,
                    username: row.username,
                  }));
              },
              include: () => builder,
              limit: () => builder,
              where: (predicate: unknown) => {
                lastPredicate = predicate;
                return builder;
              },
            };
            return builder;
          },
        },
      },
    },
  },
}));

async function search(query: string, context?: string) {
  const params = new URLSearchParams({ q: query });
  if (context) {
    params.set("context", context);
  }
  const response = await GET(
    new Request(`http://localhost:3000/api/messages/search?${params}`)
  );
  return (await response.json()) as {
    users: {
      addRefusal: "NO_DIRECT_ADDS" | "NOT_FOLLOWING_YOU" | null;
      hasIdentity: boolean;
      id: string;
      username: string;
    }[];
  };
}

const EVERYONE = {
  followsViewer: false,
  groupAddPolicy: "EVERYONE" as const,
  hasIdentity: true,
  id: "open",
  username: "openfriend",
};
const NOT_FOLLOWING = {
  followsViewer: false,
  groupAddPolicy: "FOLLOWING_ONLY" as const,
  hasIdentity: true,
  id: "guarded",
  username: "guardedfriend",
};
const NO_ADDS = {
  followsViewer: true,
  groupAddPolicy: "NO_DIRECT_ADDS" as const,
  hasIdentity: true,
  id: "closed",
  username: "closedoff",
};

beforeEach(() => {
  viewerId = "viewer";
  candidates = [EVERYONE, NOT_FOLLOWING, NO_ADDS];
  lastPredicate = null;
});

describe("GET /api/messages/search (message context)", () => {
  test("stays follow-only, because the share sheet's rule did not change", async () => {
    const body = await search("friend");
    const ids = body.users.map((user) => user.id).toSorted();
    expect(ids).toEqual(["closed"]);
  });

  test("reports no group-add refusal, having not asked", async () => {
    const body = await search("friend");
    for (const user of body.users) {
      expect(user.addRefusal).toBeNull();
    }
  });
});

describe("GET /api/messages/search (den context)", () => {
  test("finds somebody the viewer does not follow", async () => {
    // The user's first requirement: anybody can be searched for and added,
    // followed or not.
    const body = await search("friend", "den");
    const byId = new Map(body.users.map((user) => [user.id, user]));
    expect([...byId.keys()].toSorted()).toEqual(["closed", "guarded", "open"]);
    expect(byId.get("open")?.addRefusal).toBeNull();
  });

  test("reports each candidate's own reason, not one answer for the batch", async () => {
    const body = await search("friend", "den");
    const byId = new Map(body.users.map((user) => [user.id, user]));
    expect(byId.get("guarded")?.addRefusal).toBe("NOT_FOLLOWING_YOU");
    expect(byId.get("closed")?.addRefusal).toBe("NO_DIRECT_ADDS");
  });

  test("refuses a candidate who allows nobody even though they follow the viewer", async () => {
    const body = await search("closed", "den");
    expect(body.users[0]?.addRefusal).toBe("NO_DIRECT_ADDS");
    expect(GROUP_ADD_REFUSAL_COPY.NO_DIRECT_ADDS).toBeTruthy();
  });

  test("admits a candidate who allows anybody, followed or not", async () => {
    const body = await search("openfriend", "den");
    expect(body.users[0]?.addRefusal).toBeNull();
  });

  test("an unknown context falls back to the follow-only default", async () => {
    // Not a widened net by accident: anything that is not exactly "den" keeps the
    // old behaviour, so a new caller cannot pick up group-add reporting by
    // passing a value nobody expected.
    const body = await search("friend", "groups");
    const ids = body.users.map((user) => user.id).toSorted();
    expect(ids).toEqual(["closed"]);
    expect(body.users[0]?.addRefusal).toBeNull();
  });

  test("an empty query is free and answers with nothing", async () => {
    const body = await search("");
    expect(body.users).toEqual([]);
  });
});
