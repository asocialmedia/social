import { describe, expect, test } from "bun:test";

import {
  approveCommunityMember,
  parseCommunityMember,
  parseCommunityRoster,
  buildCommunitiesPath,
  fetchCreationQuota,
  fetchMembershipState,
  joinCommunity,
  leaveCommunity,
  setCommunityMemberRole,
  setCommunitySubscription,
  fetchCommunitiesPage,
  parseCommunityPage,
} from "./communities-api";

const API = "https://api.test";

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as unknown as typeof fetch;
}

const community = {
  _count: { members: 4, posts: 8 },
  accentColor: "orange",
  avatarUrl: "/avatars/general.png",
  bannerUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  description: "A place to talk",
  id: "community-1",
  mature: false,
  name: "General",
  ownerId: "user-1",
  slug: "general",
  topics: ["chat"],
  type: "PUBLIC",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("community paths and parsing", () => {
  test("encodes category, search, cursor, and joined filters", () => {
    expect(
      buildCommunitiesPath({
        category: "science_tech",
        cursor: "next cursor",
        joined: true,
        query: "two words",
      })
    ).toBe(
      "/api/communities?category=science_tech&limit=24&q=two+words&cursor=next+cursor&joined=1"
    );
  });

  test("normalizes community lists, rails, stats, and malformed rows", () => {
    const page = parseCommunityPage({
      auras: { bad: "no", "community-1": 12 },
      communities: [community, { id: "bad" }],
      counts: { all: 3 },
      joined: [community],
      nextCursor: "next",
      sections: { growing: [community], trending: [] },
      stats: { communities: 3, members: 9, posts: 14 },
      total: 3,
    });
    expect(page.communities).toHaveLength(1);
    expect(page.joined[0]?.slug).toBe("general");
    expect(page.sections.growing).toHaveLength(1);
    expect(page.auras).toEqual({ "community-1": 12 });
    expect(page.stats.posts).toBe(14);
    expect(page.nextCursor).toBe("next");
  });

  test("fetches a community page with the session cookie", async () => {
    let requested = "";
    const page = await fetchCommunitiesPage(
      { category: "all", cursor: null, query: "" },
      {
        apiBase: API,
        baseFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
          requested = String(input);
          expect(init?.headers).toEqual({ cookie: "session=1" });
          return Promise.resolve(
            Response.json({ communities: [community], total: 1 })
          );
        }) as unknown as typeof fetch,
        cookie: "session=1",
      }
    );
    expect(requested).toBe(`${API}/api/communities?category=all&limit=24`);
    expect(page.communities[0]?.name).toBe("General");
  });
});

describe("community membership mutations", () => {
  test("join posts to the membership route and returns the new state", async () => {
    let seen = "";
    const result = await joinCommunity("gen eral", {
      apiBase: API,
      baseFetch: stubFetch((url, init) => {
        seen = `${init?.method} ${url} cookie=${String(
          (init?.headers as Record<string, string>)?.cookie
        )}`;
        return Response.json({
          canModerate: false,
          membership: { role: "PARTICIPANT", status: "ACTIVE" },
          status: "ACTIVE",
          subscribed: false,
        });
      }),
      cookie: "session=1",
    });
    expect(seen).toBe(
      `POST ${API}/api/communities/gen%20eral/membership cookie=session=1`
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.state.status).toBe("ACTIVE");
      expect(result.state.membership?.role).toBe("PARTICIPANT");
    }
  });

  test("a PENDING join is reported as pending, not active", async () => {
    const result = await joinCommunity("general", {
      apiBase: API,
      baseFetch: stubFetch(() =>
        Response.json({
          canModerate: false,
          membership: { role: "PARTICIPANT", status: "PENDING" },
          status: "PENDING",
          subscribed: false,
        })
      ),
    });
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.state.status).toBe("PENDING");
    }
  });

  test("leave uses DELETE on the same route", async () => {
    let method = "";
    const result = await leaveCommunity("general", {
      apiBase: API,
      baseFetch: stubFetch((_url, init) => {
        method = init?.method ?? "";
        return Response.json({
          canModerate: false,
          membership: null,
          subscribed: false,
        });
      }),
    });
    expect(method).toBe("DELETE");
    if (result.kind === "success") {
      expect(result.state.membership).toBeNull();
    }
  });

  test("subscribe and unsubscribe pick the matching verb", async () => {
    const methods: string[] = [];
    const fetchStub = stubFetch((_url, init) => {
      methods.push(init?.method ?? "");
      return Response.json({ subscribed: true });
    });
    await setCommunitySubscription("general", true, {
      apiBase: API,
      baseFetch: fetchStub,
    });
    await setCommunitySubscription("general", false, {
      apiBase: API,
      baseFetch: fetchStub,
    });
    expect(methods).toEqual(["POST", "DELETE"]);
  });

  test("an install-token rejection is reported as retryable, not a failure", async () => {
    const result = await joinCommunity("general", {
      apiBase: API,
      baseFetch: stubFetch(() =>
        Response.json({ error: "install-token-required" }, { status: 403 })
      ),
    });
    expect(result.kind).toBe("install-token-required");
  });

  test("a domain failure surfaces the server message and status", async () => {
    const result = await joinCommunity("general", {
      apiBase: API,
      baseFetch: stubFetch(() =>
        Response.json(
          { code: "ALREADY_MEMBER", error: "You are already a member" },
          { status: 409 }
        )
      ),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("You are already a member");
      expect(result.status).toBe(409);
    }
  });

  test("an unreadable error body still yields a usable message", async () => {
    const result = await leaveCommunity("general", {
      apiBase: API,
      baseFetch: stubFetch(() => new Response("", { status: 500 })),
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("Leave failed (500)");
      expect(result.status).toBe(500);
    }
  });

  test("approve and role change target the member route", async () => {
    const calls: string[] = [];
    const fetchStub = stubFetch((url, init) => {
      calls.push(`${init?.method} ${url} ${init?.body ?? ""}`);
      return Response.json({
        membership: { role: "MEMBER", status: "ACTIVE" },
      });
    });
    await approveCommunityMember("general", "user 2", {
      apiBase: API,
      baseFetch: fetchStub,
    });
    await setCommunityMemberRole("general", "user 2", "MODERATOR", {
      apiBase: API,
      baseFetch: fetchStub,
    });
    expect(calls[0]).toBe(
      `POST ${API}/api/communities/general/members/user%202 `
    );
    expect(calls[1]).toBe(
      `PATCH ${API}/api/communities/general/members/user%202 {"role":"MODERATOR"}`
    );
  });

  test("membership state reads a joined viewer", async () => {
    const state = await fetchMembershipState("general", {
      apiBase: API,
      baseFetch: stubFetch(() =>
        Response.json({
          canModerate: true,
          membership: { role: "OWNER", status: "ACTIVE" },
          subscribed: true,
        })
      ),
    });
    expect(state.canModerate).toBe(true);
    expect(state.membership?.role).toBe("OWNER");
    expect(state.subscribed).toBe(true);
  });

  test("a membership body that is not an object is rejected", async () => {
    await expect(
      fetchMembershipState("general", {
        apiBase: API,
        baseFetch: stubFetch(() => Response.json("nope")),
      })
    ).rejects.toThrow("Membership response was not usable");
  });

  test("creation quota coerces missing numbers and returns null on failure", async () => {
    const quota = await fetchCreationQuota({
      apiBase: API,
      baseFetch: stubFetch(() =>
        Response.json({ canCreate: true, owned: "two", standing: 40 })
      ),
    });
    expect(quota?.canCreate).toBe(true);
    expect(quota?.owned).toBe(0);
    expect(quota?.standing).toBe(40);
    expect(quota?.nextRequirement).toBeNull();

    const failed = await fetchCreationQuota({
      apiBase: API,
      baseFetch: stubFetch(() => new Response("", { status: 401 })),
    });
    expect(failed).toBeNull();
  });
});

describe("community roster parsing", () => {
  const member = {
    createdAt: "2026-01-01T00:00:00.000Z",
    role: "MEMBER",
    status: "ACTIVE",
    user: {
      aura: 42,
      avatarUrl: "/avatars/general.png",
      displayName: "Ada",
      id: "user-1",
      username: "ada",
    },
  };

  test("reads a member and lifts the user fields flat", () => {
    expect(parseCommunityMember(member)).toEqual({
      aura: 42,
      avatarUrl: "/avatars/general.png",
      createdAt: "2026-01-01T00:00:00.000Z",
      displayName: "Ada",
      id: "user-1",
      role: "MEMBER",
      status: "ACTIVE",
      username: "ada",
    });
  });

  test("defaults a missing role, status and aura rather than printing undefined", () => {
    const parsed = parseCommunityMember({
      createdAt: "2026-01-01T00:00:00.000Z",
      user: { id: "user-1", username: "ada" },
    });
    expect(parsed?.role).toBe("PARTICIPANT");
    expect(parsed?.status).toBe("ACTIVE");
    expect(parsed?.aura).toBe(0);
  });

  test("drops a row with no usable user", () => {
    expect(parseCommunityMember({ role: "MEMBER" })).toBeNull();
    expect(parseCommunityMember({ user: { username: "ada" } })).toBeNull();
    expect(parseCommunityMember(null)).toBeNull();
  });

  test("reads canModerate and the viewer's own membership", () => {
    const roster = parseCommunityRoster({
      canModerate: true,
      members: [member],
      membership: { role: "OWNER", status: "ACTIVE" },
    });
    expect(roster.canModerate).toBe(true);
    expect(roster.members).toHaveLength(1);
    expect(roster.membership?.role).toBe("OWNER");
  });

  test("treats a guest as a non-moderator with no membership", () => {
    const roster = parseCommunityRoster({ members: [] });
    expect(roster.canModerate).toBe(false);
    expect(roster.membership).toBeNull();
  });

  test("skips malformed members without losing the good ones", () => {
    const roster = parseCommunityRoster({
      canModerate: false,
      members: [member, { role: "MEMBER" }, null],
    });
    expect(roster.members).toHaveLength(1);
  });

  test("survives a payload that is not an object at all", () => {
    expect(parseCommunityRoster(null)).toEqual({
      canModerate: false,
      members: [],
      membership: null,
    });
  });
});
