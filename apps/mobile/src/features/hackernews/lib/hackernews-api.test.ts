import { describe, expect, test } from "bun:test";

import {
  buildHnPath,
  domainOf,
  fetchHnPage,
  HnApiError,
  parseHnStories,
  setHnBookmark,
} from "./hackernews-api";

describe("domainOf", () => {
  test("extracts the hostname and drops a www prefix", () => {
    expect(domainOf("https://www.example.com/post")).toBe("example.com");
    expect(domainOf("https://sub.example.co.uk/x")).toBe("sub.example.co.uk");
  });

  test("returns null for a missing or unparseable url", () => {
    expect(domainOf(null)).toBeNull();
    expect(domainOf("")).toBeNull();
    // A relative url is what a malformed aggregator row would carry; new URL
    // throws on it, so it must not take the page down.
    expect(domainOf("/relative/path")).toBeNull();
  });
});

describe("buildHnPath", () => {
  test("defaults to the first page of score-sorted stories", () => {
    expect(buildHnPath()).toBe(
      "/api/hackernews?limit=20&page=1&sort=score&type=all"
    );
  });

  test("passes sort, filter and search through", () => {
    expect(
      buildHnPath({ page: 3, search: "rust", sort: "comments", type: "show" })
    ).toBe(
      "/api/hackernews?limit=20&page=3&sort=comments&type=show&search=rust"
    );
  });

  test("omits a blank search rather than sending an empty query", () => {
    expect(buildHnPath({ search: "   " })).not.toContain("search");
  });

  test("clamps a page below one", () => {
    expect(buildHnPath({ page: 0 })).toContain("page=1");
    expect(buildHnPath({ page: -5 })).toContain("page=1");
  });
});

describe("parseHnStories", () => {
  const story = {
    by: "ada",
    descendants: 12,
    id: 42,
    score: 300,
    time: 1_700_000_000,
    title: "A story",
    type: "story",
    url: "https://example.com/a",
  };

  test("reads a bare array and a wrapped payload", () => {
    expect(parseHnStories([story])).toHaveLength(1);
    expect(parseHnStories({ stories: [story] })).toHaveLength(1);
  });

  test("maps the aggregator's descendants onto the comment count", () => {
    const [parsed] = parseHnStories([story]);
    expect(parsed?.comments).toBe(12);
  });

  test("derives the domain rather than storing a raw url twice", () => {
    const [parsed] = parseHnStories([story]);
    expect(parsed?.domain).toBe("example.com");
  });

  test("accepts a story with no url", () => {
    const [parsed] = parseHnStories([{ ...story, url: undefined }]);
    expect(parsed?.url).toBeNull();
    expect(parsed?.domain).toBeNull();
  });

  test("drops rows missing an id or a title", () => {
    expect(
      parseHnStories([
        story,
        { ...story, id: undefined },
        { ...story, title: "" },
      ])
    ).toHaveLength(1);
  });

  test("returns an empty list for a payload it cannot read", () => {
    expect(parseHnStories(null)).toEqual([]);
    expect(parseHnStories({})).toEqual([]);
    expect(parseHnStories({ stories: "nope" })).toEqual([]);
  });

  test("defaults the author rather than printing undefined", () => {
    const [parsed] = parseHnStories([{ ...story, by: undefined }]);
    expect(parsed?.by).toBe("unknown");
  });
});

describe("fetchHnPage", () => {
  const options = { apiBase: "https://api.test" };

  test("reports a 429 as a state rather than throwing, so the feed can say so", async () => {
    const limited = (() =>
      Promise.resolve(
        new Response("{}", { headers: { "retry-after": "60" }, status: 429 })
      )) as unknown as typeof fetch;
    const page = await fetchHnPage({}, { ...options, baseFetch: limited });
    expect(page).toEqual({ rateLimited: true, stories: [] });
  });

  test("throws a typed error for any other failure", async () => {
    const broken = (() =>
      Promise.resolve(
        new Response("{}", { status: 500 })
      )) as unknown as typeof fetch;
    await expect(
      fetchHnPage({}, { ...options, baseFetch: broken })
    ).rejects.toBeInstanceOf(HnApiError);
  });

  test("reads a successful page", async () => {
    const ok = (() =>
      Promise.resolve(
        Response.json({
          stories: [
            {
              by: "ada",
              descendants: 3,
              id: 1,
              score: 10,
              time: 1,
              title: "T",
            },
          ],
        })
      )) as unknown as typeof fetch;
    const page = await fetchHnPage({}, { ...options, baseFetch: ok });
    expect(page.rateLimited).toBe(false);
    expect(page.stories).toHaveLength(1);
  });
});

describe("setHnBookmark", () => {
  const options = { apiBase: "https://api.test" };

  test("posts to bookmark and deletes to unbookmark", () => {
    const methods: string[] = [];
    const baseFetch = ((url: RequestInfo | URL, init?: RequestInit) => {
      methods.push(`${init?.method} ${String(url)}`);
      return Promise.resolve(new Response("", { status: 200 }));
    }) as unknown as typeof fetch;

    return Promise.all([
      setHnBookmark(7, true, { ...options, baseFetch }),
      setHnBookmark(7, false, { ...options, baseFetch }),
    ]).then(([added, removed]) => {
      expect(methods).toEqual([
        "POST https://api.test/api/hackernews/7/bookmark",
        "DELETE https://api.test/api/hackernews/7/bookmark",
      ]);
      expect(added).toBe(true);
      expect(removed).toBe(true);
    });
  });

  test("reports failure instead of throwing, so the row can roll back", async () => {
    const failing = (() =>
      Promise.resolve(
        new Response("", { status: 500 })
      )) as unknown as typeof fetch;
    expect(
      await setHnBookmark(7, true, { ...options, baseFetch: failing })
    ).toBe(false);

    const throwing = (() =>
      Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(
      await setHnBookmark(7, true, { ...options, baseFetch: throwing })
    ).toBe(false);
  });
});
