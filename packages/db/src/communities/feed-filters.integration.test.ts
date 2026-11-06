import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { getCommunityFeedPage, prisma, toPrismaDateTime } from "@asm/db";

import type { CommunityPostFilters } from "./feed-filters";

const run = randomUUID().slice(0, 8);
const owner = `feed_owner_${run}`;
let communityId = "";
let otherCommunityId = "";
const ids: Record<string, string> = {};

beforeAll(async () => {
  await prisma.orm.public.Users.create({
    displayName: "Filter owner",
    email: `${owner}@example.test`,
    id: owner,
    username: owner,
  });
  const community = await prisma.orm.public.Communities.create({
    description: "Disposable filter fixture",
    name: "Filter fixture",
    ownerId: owner,
    slug: `filters-${run}`,
  });
  communityId = community.id;
  const other = await prisma.orm.public.Communities.create({
    description: "Cursor isolation",
    name: "Other fixture",
    ownerId: owner,
    slug: `other-${run}`,
  });
  otherCommunityId = other.id;
  await Promise.all(
    [
      "text",
      "empty-embeds",
      "image",
      "video",
      "audio",
      "link",
      "explicit",
      "old",
      "quarantined",
      "gust",
      "elsewhere",
    ].map(async (kind, index) => {
      const post = await prisma.orm.public.Posts.create({
        aura: index,
        communityId: kind === "elsewhere" ? otherCommunityId : communityId,
        content: `${kind} 100%_literal café`,
        createdAt: toPrismaDateTime(
          new Date(
            Date.now() - (kind === "old" ? 40 * 86_400_000 : index * 60_000)
          )
        ),
        explicitContent: kind === "explicit",
        isGust: kind === "gust",
        userId: owner,
        ...(kind === "link"
          ? { embeds: [{ type: "link", url: "https://example.test/" }] }
          : {}),
        ...(kind === "empty-embeds" ? { embeds: [] } : {}),
      });
      ids[kind] = post.id;
      if (["image", "video", "audio", "quarantined"].includes(kind)) {
        await prisma.orm.public.PostMedia.create({
          _type:
            ({ audio: "AUDIO", video: "VIDEO" } as const)[
              kind as "video" | "audio"
            ] ?? "IMAGE",
          key: `filters/${run}/${kind}`,
          postId: post.id,
          status: kind === "quarantined" ? "QUARANTINED" : "READY",
          url: "https://example.test/test-media",
          userId: owner,
        });
      }
    })
  );
});

afterAll(async () => {
  await prisma.orm.public.Posts.where((post) =>
    post.userId.eq(owner)
  ).deleteAndCount();
  await prisma.orm.public.Communities.where((community) =>
    community.ownerId.eq(owner)
  ).deleteAndCount();
  await prisma.orm.public.Users.where({ id: owner }).deleteAndCount();
});

function page(
  filters: Partial<CommunityPostFilters>,
  cursor?: string,
  sort: "new" | "top" = "new",
  limit = 20
) {
  return getCommunityFeedPage({
    communityId,
    cursor,
    filters,
    limit,
    loggedInUserId: "",
    sort,
  });
}

async function matchingIds(
  filters: Partial<CommunityPostFilters>,
  cursor?: string
) {
  const result = await page(filters, cursor);
  return result.posts.map((post) => post.id);
}

test("filters media in SQL and excludes quarantined uploads and gusts", async () => {
  expect(await matchingIds({ type: "images" })).toEqual([ids.image]);
  expect(await matchingIds({ type: "videos" })).toEqual([ids.video]);
  expect(await matchingIds({ type: "audio" })).toEqual([ids.audio]);
  expect(await matchingIds({ type: "links" })).toEqual([ids.link]);
  const textIds = await matchingIds({ type: "text" });
  expect(textIds).toContain(ids.text);
  expect(textIds).toContain(ids["empty-embeds"]);
  expect(textIds).not.toContain(ids.image);
  expect(textIds).not.toContain(ids.link);
  expect(textIds).not.toContain(ids.gust);
});

test("combines date, rating, literal Unicode search and exact author", async () => {
  const result = await page({
    author: `@${owner.toUpperCase()}`,
    query: "100%_literal CAFÉ",
    range: "week",
    rating: "safe",
  });
  expect(result.posts.length).toBeGreaterThan(0);
  expect(result.posts.map((post) => post.id)).not.toContain(ids.old);
  expect(result.posts.map((post) => post.id)).not.toContain(ids.explicit);
  expect(await matchingIds({ rating: "explicit" })).toEqual([ids.explicit]);
  expect(await matchingIds({ query: "100XXliteral" })).toHaveLength(0);
  expect(await matchingIds({ author: `${owner}%` })).toHaveLength(0);
  expect(await matchingIds({ author: "missing-author" })).toHaveLength(0);
});

test.each(["new", "top"] as const)(
  "filters before %s pagination without duplicate pages",
  async (sort) => {
    const first = await page({ rating: "safe" }, undefined, sort, 2);
    expect(first.posts).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(
      { rating: "safe" },
      first.nextCursor ?? undefined,
      sort,
      2
    );
    expect(second.posts).toHaveLength(2);
    expect(
      second.posts.some((post) =>
        first.posts.some((entry) => entry.id === post.id)
      )
    ).toBe(false);
    expect(
      [...first.posts, ...second.posts].every(
        (post) => !post.explicitContent && post.communityId === communityId
      )
    ).toBe(true);
  }
);

test("ignores another community's cursor and a cursor excluded by current filters", async () => {
  const expected = await matchingIds({ type: "images" });
  expect(await matchingIds({ type: "images" }, ids.elsewhere)).toEqual(
    expected
  );
  expect(await matchingIds({ type: "images" }, ids.text)).toEqual(expected);
});
