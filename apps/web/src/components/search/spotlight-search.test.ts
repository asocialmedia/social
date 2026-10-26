import { describe, expect, test } from "bun:test";

import {
  readRecentSearches,
  rememberSearch,
  rememberResult,
  readSearchCandidates,
  rememberCandidates,
  suggestedResults,
} from "./spotlight-search";
import type { SearchTarget } from "./spotlight-search";

const vercel: SearchTarget = {
  avatarUrl: "https://cdn.bsky.app/avatar/vercel.jpg",
  displayName: "Vercel",
  href: "/network/bluesky/profile?actor=did%3Aplc%3Avercel",
  id: "bluesky-user-did:plc:vercel",
  source: "bluesky",
  subtitle: "@vercel.com",
  type: "user",
};
const post: SearchTarget = {
  displayName: "Our Vercel launch",
  href: "/posts/launch/our-vercel-launch",
  id: "asm-post-launch",
  source: "asm",
  subtitle: "@builder",
  type: "post",
};

describe("spotlight recent searches", () => {
  test("rejects corrupt storage and invalid entries without losing valid history", () => {
    expect(readRecentSearches("not json")).toEqual([]);
    expect(readRecentSearches("{} ")).toEqual([]);
    expect(
      readRecentSearches(
        JSON.stringify([
          { query: "  astronomy  ", searchedAt: 123, source: "bluesky" },
          { query: "", searchedAt: 123, source: "all" },
          { query: "x".repeat(81), searchedAt: 123, source: "all" },
          { query: "software", searchedAt: 123, source: "unknown" },
          { query: "software", searchedAt: "yesterday", source: "asm" },
          null,
        ])
      )
    ).toEqual([{ query: "astronomy", searchedAt: 123, source: "bluesky" }]);
  });

  test("deduplicates within a source while keeping the source for replay", () => {
    const first = rememberSearch([], "Astronomy", "asm", 1);
    const second = rememberSearch(first, "astronomy", "bluesky", 2);
    expect(rememberSearch(second, " ASTRONOMY ", "asm", 3)).toEqual([
      { query: "ASTRONOMY", searchedAt: 3, source: "asm" },
      { query: "astronomy", searchedAt: 2, source: "bluesky" },
    ]);
  });

  test("keeps only ten recent queries and bounds query length", () => {
    let history = rememberSearch([], "first", "all", 0);
    for (let index = 0; index < 15; index += 1) {
      history = rememberSearch(history, `query ${index}`, "all", index);
    }
    expect(history).toHaveLength(10);
    expect(history[0]?.query).toBe("query 14");
    expect(rememberSearch(history, "  ", "asm")).toBe(history);
    expect(
      rememberSearch(history, "x".repeat(100), "all")[0]?.query
    ).toHaveLength(80);
    expect(
      readRecentSearches(JSON.stringify([...history, ...history]))
    ).toHaveLength(10);
  });
});

test("opened Bluesky profiles replace text-only queries and survive storage round trips", () => {
  const queries = rememberSearch([], "vercel", "all", 1);
  const history = rememberResult(queries, vercel, "vercel", 2);
  expect(history).toHaveLength(1);
  expect(history[0]?.target?.displayName).toBe("Vercel");
  expect(history[0]?.target?.avatarUrl).toBe(vercel.avatarUrl);
  expect(history[0]?.target?.href).toBe(vercel.href);
  expect(readRecentSearches(JSON.stringify(history))).toEqual(history);
  const again = rememberResult(history, vercel, "vercel.com", 3);
  expect(again).toHaveLength(1);
  expect(again[0]?.query).toBe("vercel.com");
  expect(again[0]?.searchedAt).toBe(3);
  const both = rememberResult(again, post, "vercel", 4);
  expect(both.map((entry) => entry.target?.type)).toEqual(["post", "user"]);
});

test("history rejects unsafe result destinations while retaining legacy text searches", () => {
  const nativeProfile = rememberResult(
    [],
    { ...vercel, href: "/parazeeknova", source: "asm" },
    "parazeeknova"
  );
  expect(nativeProfile[0]?.target?.href).toBe("/parazeeknova");
  for (const href of [
    ["java", "script:alert(1)"].join(""),
    "//evil.example",
    "/users/\\evil",
    "https://evil.example/users/test",
  ]) {
    expect(rememberResult([], { ...vercel, href }, "vercel")).toEqual([]);
  }
  const gust = rememberResult(
    [],
    { ...post, href: "/gusts?id=launch" },
    "launch",
    2
  );
  expect(gust[0]?.target?.href).toBe("/gusts?id=launch");
  const malformed = [
    {
      query: "vercel",
      searchedAt: 1,
      source: "bluesky",
      target: { ...vercel, href: "//evil.example" },
    },
  ];
  expect(readRecentSearches(JSON.stringify(malformed))).toEqual([]);
});

test("suggestions follow recent searches, respect filters, and omit opened or sensitive results", () => {
  let candidates = rememberCandidates([], [vercel, post], "vercel", 1);
  const next = { ...vercel, displayName: "Next.js", id: "bluesky-user-next" };
  candidates = rememberCandidates(candidates, [next, vercel], "nextjs", 2);
  expect(candidates).toHaveLength(3);
  expect(candidates.find((entry) => entry.target.id === vercel.id)?.query).toBe(
    "nextjs"
  );
  const history = rememberResult([], vercel, "vercel", 3);
  expect(
    suggestedResults(candidates, history, "all", "all", 4).map(
      (entry) => entry.target.id
    )
  ).toEqual([next.id, post.id]);
  expect(suggestedResults(candidates, history, "bluesky", "post", 4)).toEqual(
    []
  );
  expect(
    suggestedResults(candidates, history, "asm", "post", 4).map(
      (entry) => entry.target.id
    )
  ).toEqual([post.id]);
  expect(suggestedResults(candidates, history, "all", "community", 4)).toEqual(
    []
  );
  expect(
    rememberCandidates([], [{ ...post, explicitContent: true }], "vercel", 1)
  ).toEqual([]);
  expect(
    suggestedResults(candidates, [], "all", "all", 8 * 24 * 60 * 60 * 1000)
  ).toEqual([]);
  expect(readSearchCandidates("broken")).toEqual([]);
});

test("candidate storage has a fixed size and excludes malformed and expired entries", () => {
  const targets = Array.from({ length: 80 }, (_, index) => ({
    ...vercel,
    id: `bluesky-user-${index}`,
  }));
  const candidates = rememberCandidates([], targets, "vercel", 1);
  expect(candidates).toHaveLength(32);
  expect(readSearchCandidates(JSON.stringify(candidates), 2)).toEqual(
    candidates
  );
  expect(
    readSearchCandidates(JSON.stringify(candidates), 8 * 24 * 60 * 60 * 1000)
  ).toEqual([]);
  const sensitive = rememberResult(
    [],
    { ...post, explicitContent: true },
    "launch",
    1
  );
  expect(sensitive[0]?.target?.displayName).toBe("Sensitive post");
});
