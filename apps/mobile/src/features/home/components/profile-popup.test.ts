import { describe, expect, test } from "bun:test";

import {
  LINK_PREVIEW_STALE_MS,
  POPUP_STALE_MS,
  PopupCache,
} from "./profile-cache";
import {
  fetchBookmarkTotal,
  fetchLinkPreview,
  fetchPopupProfile,
} from "./profile-data";
import {
  badgeRank,
  clampBioSegments,
  formatJoinedDate,
  formatNumber,
  getAuraFlameStyle,
  getBadgePanelItems,
  getLinkPlatform,
  getSocialLinks,
  hostLabel,
  normalizeBadges,
  parseLinkPreview,
  rankBadges,
  resolveProfileImageUrl,
  safeLinkUrl,
  safeSocialUrl,
  segmentBioContent,
} from "./profile-utils";

const API = "http://localhost:3000";

describe("formatNumber", () => {
  test("compacts thousands and millions like web", () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(1500)).toBe("1.5k");
    expect(formatNumber(2000)).toBe("2k");
    expect(formatNumber(2_500_000)).toBe("2.5m");
    expect(formatNumber(-1500)).toBe("-1.5k");
  });
});

describe("getAuraFlameStyle", () => {
  test("maps the web tiers to colors", () => {
    expect(getAuraFlameStyle(-5)).toEqual({
      color: "#a78bfa",
      filled: true,
    });
    expect(getAuraFlameStyle(0)).toEqual({
      color: "#f97316",
      filled: false,
    });
    expect(getAuraFlameStyle(485)).toEqual({
      color: "#f97316",
      filled: true,
    });
    expect(getAuraFlameStyle(800)).toEqual({
      color: "#ea580c",
      filled: true,
    });
    expect(getAuraFlameStyle(5000)).toEqual({
      color: "#f87171",
      filled: true,
    });
    expect(getAuraFlameStyle(50_000)).toEqual({
      color: "#fde047",
      filled: true,
    });
  });
});

describe("formatJoinedDate", () => {
  test("renders month and year", () => {
    expect(formatJoinedDate("2024-03-15T00:00:00.000Z")).toBe("March 2024");
  });

  test("rejects garbage", () => {
    expect(formatJoinedDate("not-a-date")).toBe("");
    expect(formatJoinedDate("")).toBe("");
  });
});

describe("getSocialLinks", () => {
  test("builds rows in web order, skipping blanks", () => {
    expect(
      getSocialLinks({
        customDomain: "https://example.com",
        githubUsername: "octo",
        linkedinUsername: null,
        redditUsername: "redditor",
        twitterUsername: "birb",
      })
    ).toEqual([
      {
        href: "https://example.com",
        kind: "website",
        label: "Website: example.com",
      },
      {
        href: "https://github.com/octo",
        kind: "github",
        label: "GitHub: octo",
      },
      {
        href: "https://x.com/birb",
        kind: "twitter",
        label: "Twitter / X: birb",
      },
      {
        href: "https://www.reddit.com/user/redditor",
        kind: "reddit",
        label: "Reddit: redditor",
      },
    ]);
  });

  test("returns nothing when no socials are set", () => {
    expect(getSocialLinks({})).toEqual([]);
  });
});

describe("resolveProfileImageUrl", () => {
  test("passes absolute URLs through", () => {
    expect(resolveProfileImageUrl("https://cdn.example/a.png", API)).toBe(
      "https://cdn.example/a.png"
    );
  });

  test("roots proxy paths at the API base", () => {
    expect(resolveProfileImageUrl("/api/users/avatar/x/image?v=1", API)).toBe(
      `${API}/api/users/avatar/x/image?v=1`
    );
  });

  test("roots proxy AND default-avatar paths at the API base", () => {
    expect(resolveProfileImageUrl("/api/users/avatar/x/image?v=1", API)).toBe(
      `${API}/api/users/avatar/x/image?v=1`
    );
    expect(resolveProfileImageUrl("/avatars/default-1.png", API)).toBe(
      `${API}/avatars/default-1.png`
    );
  });

  test("rejects blanks and relative paths", () => {
    expect(resolveProfileImageUrl(null, API)).toBeNull();
    expect(resolveProfileImageUrl("", API)).toBeNull();
    expect(resolveProfileImageUrl("avatars/x.png", API)).toBeNull();
  });
});

describe("safeSocialUrl", () => {
  test("accepts the built https links", () => {
    expect(
      safeSocialUrl({
        href: "https://github.com/octo",
        kind: "github",
        label: "GitHub: octo",
      })
    ).toBe("https://github.com/octo");
    expect(
      safeSocialUrl({
        href: "https://example.com",
        kind: "website",
        label: "Website: example.com",
      })
    ).toBe("https://example.com");
  });

  test("rejects schemes, host swaps and credential tricks", () => {
    const github = {
      kind: "github",
      label: "GitHub: octo",
    } as const;
    expect(
      // Built dynamically: the literal trips the no-script-url lint rule.
      safeSocialUrl({ ...github, href: `javascript:${"alert(1)"}` })
    ).toBeNull();
    expect(
      safeSocialUrl({ ...github, href: "http://github.com/octo" })
    ).toBeNull();
    expect(
      safeSocialUrl({ ...github, href: "https://evil.example/octo" })
    ).toBeNull();
    expect(
      safeSocialUrl({ ...github, href: "https://octo@github.com/" })
    ).toBeNull();
    expect(safeSocialUrl({ ...github, href: "::::" })).toBeNull();
  });
});

describe("badge ranking", () => {
  test("orders both families by shared precedence", () => {
    expect(badgeRank("author")).toBeLessThan(badgeRank("OWNER"));
    expect(badgeRank("OWNER")).toBeLessThan(badgeRank("dev"));
    expect(badgeRank("mystery")).toBeGreaterThan(badgeRank("trending"));
  });

  test("normalizeBadges dedupes, drops unknowns and sorts", () => {
    expect(
      normalizeBadges(["early", "author", "bogus", "author", null])
    ).toEqual(["author", "early"]);
  });

  test("rankBadges interleaves platform and role badges", () => {
    expect(
      rankBadges(
        "early",
        ["dev"],
        [
          { community: { slug: "a" }, role: "OWNER" },
          { community: { slug: null }, role: "MEMBER" },
        ]
      )
    ).toEqual([
      { kind: "role", type: "OWNER" },
      { kind: "platform", type: "dev" },
      { kind: "platform", type: "early" },
    ]);
  });
});

function jsonFetch(payload: unknown, status = 200) {
  return ((_input: unknown, _init?: unknown) =>
    Promise.resolve(Response.json(payload, { status }))) as typeof fetch;
}

describe("fetchPopupProfile", () => {
  test("parses the profile projection", async () => {
    const profile = await fetchPopupProfile({
      apiBase: API,
      baseFetch: jsonFetch({
        _count: { followers: 3, following: 4, posts: 10 },
        aura: 485,
        avatarUrl: "/api/users/avatar/x/image",
        badge: "author",
        badges: ["dev"],
        bannerUrl: null,
        bio: "hi",
        communityMemberships: [],
        createdAt: "2024-03-15T00:00:00.000Z",
        customDomain: null,
        displayName: "Asocial",
        githubUsername: "octo",
        username: "asocialmedia",
      }),
      cookie: "better-auth.session_token=tok.sig",
      userId: "x",
    });
    expect(profile.username).toBe("asocialmedia");
    expect(profile._count.posts).toBe(10);
    expect(profile.badges).toEqual(["dev"]);
  });

  test("sends the stored cookie and throws on failure", async () => {
    const seen: string[] = [];
    const baseFetch = ((input: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("cookie") ?? "");
      return Promise.resolve(new Response("{}", { status: 401 }));
    }) as typeof fetch;
    await expect(
      fetchPopupProfile({
        apiBase: API,
        baseFetch,
        cookie: "better-auth.session_token=tok.sig",
        userId: "x",
      })
    ).rejects.toThrow("Profile request failed (401)");
    expect(seen).toEqual(["better-auth.session_token=tok.sig"]);
  });

  test("rejects an unusable payload", async () => {
    await expect(
      fetchPopupProfile({
        apiBase: API,
        baseFetch: jsonFetch({ nope: true }),
        userId: "x",
      })
    ).rejects.toThrow("Profile response was not usable");
  });
});

describe("fetchBookmarkTotal", () => {
  test("returns the sidebar total", async () => {
    await expect(
      fetchBookmarkTotal({
        apiBase: API,
        baseFetch: jsonFetch({ totalCount: 7 }),
      })
    ).resolves.toBe(7);
  });

  test("throws when the request fails", async () => {
    await expect(
      fetchBookmarkTotal({
        apiBase: API,
        baseFetch: jsonFetch({}, 401),
      })
    ).rejects.toThrow("Bookmark count request failed (401)");
  });
});

function stubProfile(username = "asocialmedia") {
  return {
    _count: { followers: 1, following: 2, posts: 3 },
    aura: 10,
    avatarUrl: null,
    badge: null,
    badges: [],
    bannerUrl: null,
    bio: null,
    communityMemberships: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    customDomain: null,
    displayName: null,
    githubUsername: null,
    linkedinUsername: null,
    redditUsername: null,
    twitterUsername: null,
    username,
  };
}

describe("PopupCache", () => {
  test("serves fresh entries with no network", () => {
    let now = 1000;
    const cache = new PopupCache(() => now);
    cache.setProfile("u1", stubProfile());
    cache.setBookmarkTotal("u1", 7);
    expect(cache.getFreshProfile("u1")?.username).toBe("asocialmedia");
    expect(cache.getFreshBookmarkTotal("u1")).toBe(7);
    now += POPUP_STALE_MS;
    expect(cache.getFreshProfile("u1")).toBeNull();
    expect(cache.getFreshBookmarkTotal("u1")).toBeNull();
    expect(cache.getStaleProfile("u1")?.username).toBe("asocialmedia");
  });

  test("keys entries per user", () => {
    const cache = new PopupCache();
    cache.setProfile("u1", stubProfile("one"));
    expect(cache.getFreshProfile("u2")).toBeNull();
    expect(cache.getFreshProfile("u1")?.username).toBe("one");
  });

  test("invalidate drops one user or everything", () => {
    const cache = new PopupCache();
    cache.setProfile("u1", stubProfile("one"));
    cache.setProfile("u2", stubProfile("two"));
    cache.invalidate("u1");
    expect(cache.getFreshProfile("u1")).toBeNull();
    expect(cache.getFreshProfile("u2")?.username).toBe("two");
    cache.invalidate();
    expect(cache.getFreshProfile("u2")).toBeNull();
  });

  test("clear drops everything including bookmark totals", () => {
    const cache = new PopupCache();
    cache.setProfile("u1", stubProfile());
    cache.setBookmarkTotal("u1", 7);
    cache.clear();
    expect(cache.getStaleProfile("u1")).toBeNull();
    expect(cache.getStaleBookmarkTotal("u1")).toBeNull();
  });

  test("caps capacity by evicting the oldest", () => {
    const cache = new PopupCache(() => 0, 2);
    cache.setProfile("u1", stubProfile("one"));
    cache.setProfile("u2", stubProfile("two"));
    cache.setProfile("u3", stubProfile("three"));
    expect(cache.getStaleProfile("u1")).toBeNull();
    expect(cache.getStaleProfile("u3")?.username).toBe("three");
  });
});

describe("segmentBioContent", () => {
  test("splits urls, mentions and tags", () => {
    expect(
      segmentBioContent("hi @octo, see https://example.com/a. #ship")
    ).toEqual([
      { text: "hi ", type: "text" },
      { type: "mention", username: "octo" },
      { text: ", see ", type: "text" },
      { type: "url", url: "https://example.com/a" },
      { text: ". ", type: "text" },
      { tag: "ship", type: "tag" },
    ]);
  });

  test("keeps trailing punctuation out of links", () => {
    expect(segmentBioContent("(see https://x.com/a!)")).toEqual([
      { text: "(see ", type: "text" },
      { type: "url", url: "https://x.com/a" },
      { text: "!)", type: "text" },
    ]);
  });

  test("plain text stays one segment", () => {
    expect(segmentBioContent("just words")).toEqual([
      { text: "just words", type: "text" },
    ]);
    expect(segmentBioContent("")).toEqual([]);
  });
});

describe("hostLabel + getLinkPlatform", () => {
  test("strips www, falls back to raw input", () => {
    expect(hostLabel("https://www.example.com/x")).toBe("example.com");
    expect(hostLabel("::::")).toBe("::::");
  });

  test("maps platforms with brand colors", () => {
    expect(getLinkPlatform("https://youtu.be/x")).toEqual({
      color: "#ff0000",
      icon: "youtube",
    });
    expect(getLinkPlatform("https://x.com/a")).toEqual({
      color: null,
      icon: "x-twitter",
    });
    expect(getLinkPlatform("https://www.reddit.com/u/a")).toEqual({
      color: "#ff4500",
      icon: "reddit",
    });
    expect(getLinkPlatform("https://open.spotify.com/x")).toEqual({
      color: "#1DB954",
      icon: "spotify",
    });
    expect(getLinkPlatform("https://example.com")).toBeNull();
    expect(getLinkPlatform("::::")).toBeNull();
  });
});

describe("safeLinkUrl", () => {
  test("accepts https, rejects the rest", () => {
    expect(safeLinkUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeLinkUrl("http://example.com/")).toBeNull();
    // Built dynamically: the literal trips the no-script-url lint rule.
    expect(safeLinkUrl(`java${"script:alert(1)"}`)).toBeNull();
  });
});

describe("getBadgePanelItems", () => {
  test("lists every badge in rail order with copy", () => {
    const items = getBadgePanelItems(
      "early",
      ["dev"],
      [{ community: { slug: "a" }, role: "OWNER" }]
    );
    expect(items.map((item) => item.type)).toEqual(["OWNER", "dev", "early"]);
    expect(items[0]).toMatchObject({
      kind: "role",
      title: "Owner",
    });
    expect(items[1]).toMatchObject({
      description: "Builds the stuff you're scrolling through",
      kind: "platform",
      title: "Developer",
    });
  });

  test("returns nothing without badges", () => {
    expect(getBadgePanelItems(null, null, null)).toEqual([]);
  });
});

describe("parseLinkPreview", () => {
  test("accepts wrapped and bare payloads with titles", () => {
    expect(parseLinkPreview({ embed: { title: "  Cool  " } })).toEqual({
      title: "Cool",
    });
    expect(parseLinkPreview({ title: "Hi" })).toEqual({ title: "Hi" });
  });

  test("rejects title-less payloads", () => {
    expect(parseLinkPreview({ embed: {} })).toBeNull();
    expect(parseLinkPreview({ title: "   " })).toBeNull();
    expect(parseLinkPreview(null)).toBeNull();
  });
});

describe("PopupCache link previews", () => {
  test("caches titles with a longer stale window", () => {
    let now = 1000;
    const cache = new PopupCache(() => now);
    cache.setLinkPreview("https://a.example", { title: "A" });
    expect(cache.getFreshLinkPreview("https://a.example")?.title).toBe("A");
    now += POPUP_STALE_MS;
    expect(cache.getFreshLinkPreview("https://a.example")?.title).toBe("A");
    now += LINK_PREVIEW_STALE_MS;
    expect(cache.getFreshLinkPreview("https://a.example")).toBeNull();
    expect(cache.getLinkPreview("https://a.example")?.title).toBe("A");
  });

  test("clear drops previews too", () => {
    const cache = new PopupCache();
    cache.setLinkPreview("https://a.example", { title: "A" });
    cache.clear();
    expect(cache.getLinkPreview("https://a.example")).toBeNull();
  });
});

describe("fetchLinkPreview", () => {
  test("returns the parsed preview", async () => {
    await expect(
      fetchLinkPreview("https://example.com", {
        apiBase: API,
        baseFetch: jsonFetch({ embed: { title: "Example" } }),
      })
    ).resolves.toEqual({ title: "Example" });
  });

  test("returns null on failure", async () => {
    await expect(
      fetchLinkPreview("https://example.com", {
        apiBase: API,
        baseFetch: jsonFetch({}, 500),
      })
    ).resolves.toBeNull();
  });
});

describe("clampBioSegments", () => {
  test("admits a long first pill whole", () => {
    const long = segmentBioContent("https://example.com/a-very-long-url-here");
    const { clamped, visible } = clampBioSegments(long, 10);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toEqual({
      type: "url",
      url: "https://example.com/a-very-long-url-here",
    });
    expect(clamped).toBe(false);
  });

  test("truncates a long opening paragraph with Show more", () => {
    const long = "a".repeat(500);
    const { clamped, visible } = clampBioSegments(segmentBioContent(long), 400);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toEqual({ text: "a".repeat(400), type: "text" });
    expect(clamped).toBe(true);
  });

  test("cuts later segments at the boundary", () => {
    const segments = segmentBioContent("hi @octo see this");
    const { clamped, visible } = clampBioSegments(segments, 8);
    expect(visible).toEqual([
      { text: "hi ", type: "text" },
      { type: "mention", username: "octo" },
    ]);
    expect(clamped).toBe(true);
  });
});

describe("profile request timeout", () => {
  test("aborts a stalled request instead of hanging", async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      // oxlint-disable-next-line promise/avoid-new -- constructing a hanging fetch is the entire point of this test
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      })) as typeof fetch;
    await expect(
      fetchPopupProfile({
        apiBase: API,
        baseFetch: hanging,
        timeoutMs: 50,
        userId: "x",
      })
    ).rejects.toThrow();
  });
});
