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

test("profile changes affect every mode and invalidate cursors; unmatched interests never fall back to popular posts", async () => {
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
        expect(page.nextCursor).toBeNull();
      })
    )
  );
}, 20_000);
