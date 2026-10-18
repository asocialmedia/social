import { afterAll, beforeAll, expect, test } from "bun:test";

import {
  closePrisma,
  prisma,
  readNetworkPreferences,
  recordNetworkSignal,
  redis,
  saveNetworkPreferences,
} from "@asm/db";
import type { PostsPage } from "@asm/db";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import { networkPostRecommended } from "@/lib/posts/network-content-policy";

import { networkNativeFeed } from "./network-native-feed";

const userId = crypto.randomUUID();
const generations = new Set<string>();
const fixtures: { id: string; isGust: boolean; topic: string }[] = [];
let settings = { preferences: defaultNetworkPreferences(), revision: 0 };

async function choose(interests: string[]) {
  await saveNetworkPreferences(
    userId,
    {
      ...settings.preferences,
      language: "all",
      profiles: [{ id: "default", interests, name: "Focused" }],
      region: "all",
    },
    settings.revision
  );
  settings = await readNetworkPreferences(userId);
}

async function read(
  mode: "personalized" | "latest" | "trending",
  kind: "post" | "gust",
  cursor?: string
) {
  const query = new URLSearchParams({ take: "20" });
  if (cursor) {
    query.set("cursor", cursor);
  }
  const response = await networkNativeFeed(
    new Request(`http://localhost/feed?${query}`),
    userId,
    mode,
    kind
  );
  const page: PostsPage = await response.json();
  if (page.nextCursor) {
    generations.add(page.nextCursor.split(".")[1] ?? "");
  }
  return { page, status: response.status };
}

beforeAll(async () => {
  await prisma.orm.public.Users.create({
    displayName: "Focused feed fixture",
    id: userId,
    username: `focused-feed-${userId}`,
  });
  await Promise.all(
    [false, true].flatMap((isGust) =>
      ["software", "software", "politics"].map(async (topic) => {
        const post = await prisma.orm.public.Posts.create({
          aura: topic === "politics" ? 1_000_000 : 1,
          content:
            topic === "software"
              ? "TypeScript and React hooks software tutorial"
              : "Politics election news and world headlines",
          isGust,
          semanticTags: [topic],
          trendingScore: topic === "politics" ? 1_000_000 : 10_000,
          userId,
        });
        fixtures.push({ id: post.id, isGust, topic });
        await prisma.orm.public.Votes.create({
          postId: post.id,
          userId,
          value: 1,
        });
        if (isGust) {
          await prisma.orm.public.PostMedia.create({
            _type: "VIDEO",
            mimeType: "video/mp4",
            postId: post.id,
            status: "READY",
            url: "https://example.test/focused-feed.mp4",
            userId,
          });
        }
      })
    )
  );
  await choose(["software", "web development", "tech"]);
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      recordNetworkSignal(
        userId,
        "default",
        {
          authorId: userId,
          createdAt: Date.now(),
          hasImage: false,
          kind: "bookmark",
          tags: ["politics", "news"],
        },
        `focused-feed-drift-${index}`
      )
    )
  );
});

afterAll(async () => {
  await prisma.orm.public.Users.where({ id: userId }).delete();
  const signalKeys = await redis.keys(`rec:network:v1:{${userId}:*`);
  const keys = [
    ...signalKeys,
    ...[...generations].map(
      (generation) => `rec:network-feed:v1:${generation}`
    ),
  ];
  if (keys.length) {
    await redis.del(...keys);
  }
  await closePrisma();
  redis.disconnect();
});

test("all five recommendation modes exclude viral politics despite learned political activity", async () => {
  await Promise.all(
    (
      [
        ["post", ["personalized", "latest", "trending"]],
        ["gust", ["personalized", "latest"]],
      ] as const
    ).flatMap(([kind, modes]) =>
      modes.map(async (mode) => {
        const { page, status } = await read(mode, kind);
        expect(status).toBe(200);
        expect(page.posts.length).toBeGreaterThan(0);
        expect(
          page.posts.every((post) =>
            networkPostRecommended(post, settings.preferences)
          )
        ).toBe(true);
        expect(
          page.posts.some((post) =>
            fixtures.some(
              (fixture) =>
                fixture.id === post.id && fixture.topic === "politics"
            )
          )
        ).toBe(false);
        expect(
          page.posts.some((post) =>
            fixtures.some(
              (fixture) =>
                fixture.id === post.id &&
                fixture.topic === "software" &&
                fixture.isGust === (kind === "gust")
            )
          )
        ).toBe(true);
      })
    )
  );
}, 20_000);

test("profile changes invalidate cursors; unmatched ranked feeds can continue into discovery", async () => {
  const previous = await networkNativeFeed(
    new Request("http://localhost/feed?take=1"),
    userId,
    "latest"
  );
  const first: PostsPage = await previous.json();
  expect(first.posts).toHaveLength(1);
  expect(first.nextCursor).toBeString();
  if (!first.nextCursor) {
    throw new Error("The two matching fixtures must produce a next page");
  }
  const next = await read("latest", "post", first.nextCursor);
  expect(next.status).toBe(200);
  expect(next.page.posts.length).toBeGreaterThan(0);
  expect(
    next.page.posts.some((post) =>
      first.posts.some((head) => head.id === post.id)
    )
  ).toBe(false);
  await choose(["politics"]);
  await Promise.all(
    (["post", "gust"] as const).flatMap((kind) =>
      (["personalized", "latest", "trending"] as const).map(async (mode) => {
        const { page } = await read(mode, kind);
        expect(
          page.posts.every((post) =>
            networkPostRecommended(post, settings.preferences)
          )
        ).toBe(true);
        expect(
          page.posts.some((post) =>
            fixtures.some(
              (fixture) =>
                fixture.id === post.id && fixture.topic === "software"
            )
          )
        ).toBe(false);
        expect(
          page.posts.some((post) =>
            fixtures.some(
              (fixture) =>
                fixture.id === post.id && fixture.topic === "politics"
            )
          )
        ).toBe(true);
      })
    )
  );
  const stale = await read("latest", "post", first.nextCursor);
  expect(stale.status).toBe(410);
  await choose([`unmatched-${crypto.randomUUID()}`]);
  await Promise.all(
    (["post", "gust"] as const).flatMap((kind) =>
      (["personalized", "latest", "trending"] as const).map(async (mode) => {
        const { page } = await read(mode, kind);
        expect(page.posts).toEqual([]);
        if (mode === "latest") {
          expect(page.nextCursor).toBeNull();
        } else {
          expect(page.nextCursor).toBeString();
        }
      })
    )
  );
}, 20_000);

test("exhausted ranked pools expand without repeating focused results or bypassing exclusions", async () => {
  await choose(["software"]);
  await saveNetworkPreferences(
    userId,
    { ...settings.preferences, avoidedTopics: ["politics"] },
    settings.revision
  );
  settings = await readNetworkPreferences(userId);
  const first = await read("personalized", "post");
  const known = new Set(first.page.posts.map((post) => post.id));
  let cursor = first.page.nextCursor;
  let expanded = false;
  for (let pageIndex = 0; cursor && pageIndex < 8; pageIndex += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each page consumes the prior page's private continuation.
    const next = await read("personalized", "post", cursor);
    expect(next.status).toBe(200);
    for (const post of next.page.posts) {
      expect(known.has(post.id)).toBe(false);
      known.add(post.id);
      expect(post.content.toLowerCase()).not.toContain("politics");
      expect(networkPostRecommended(post, settings.preferences)).toBe(true);
    }
    expanded ||= next.page.posts.length > 0;
    cursor = next.page.nextCursor;
  }
  expect(expanded).toBe(true);
}, 20_000);

test("a new post with a large stale score stays out of Trending until it has a recorded reaction", async () => {
  await choose(["software"]);
  const quiet = await prisma.orm.public.Posts.create({
    content: "Software tutorial with no reactions",
    semanticTags: ["software"],
    trendingScore: 9_999_999,
    userId,
  });
  const trending = await read("trending", "post");
  expect(trending.page.posts.some((post) => post.id === quiet.id)).toBe(false);
  const latest = await read("latest", "post");
  expect(latest.page.posts.some((post) => post.id === quiet.id)).toBe(true);
  await prisma.orm.public.Votes.create({ postId: quiet.id, userId, value: 1 });
  const reacted = await read("trending", "post");
  expect(reacted.page.posts.some((post) => post.id === quiet.id)).toBe(true);
}, 20_000);
