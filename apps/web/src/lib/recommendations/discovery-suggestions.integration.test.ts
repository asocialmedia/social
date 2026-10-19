import { afterAll, beforeAll, expect, mock, test } from "bun:test";

import {
  closePrisma,
  prisma,
  redis,
  recordNetworkSignal,
  saveNetworkPreferences,
} from "@asm/db";
import type { ExternalAuthor, ExternalPost } from "@asm/protocols/contracts";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";

const ids = Array.from({ length: 7 }, () => crypto.randomUUID());
const [
  techViewer = "",
  gardenViewer = "",
  friend = "",
  techAuthor = "",
  gardenAuthor = "",
  blockedAuthor = "",
  bannedAuthor = "",
] = ids;
const suffix = crypto.randomUUID().replaceAll("-", "");
const techTopic = `software${suffix}`;
const gardenTopic = `gardening${suffix}`;
const postIds = Array.from({ length: 4 }, () => crypto.randomUUID());
function remoteAuthor(topic: string): ExternalAuthor {
  return {
    description: topic,
    displayName: topic,
    handle: `${topic}.bsky.social`,
    id: `did:plc:${topic}`,
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: `https://bsky.app/profile/${topic}`,
  };
}
function remotePost(topic: string): ExternalPost {
  return {
    author: remoteAuthor(topic),
    createdAt: new Date().toISOString(),
    id: `at://did:plc:${topic}/app.bsky.feed.post/fixture`,
    indexedAt: new Date().toISOString(),
    labels: [],
    languages: ["en"],
    media: [],
    revision: "1",
    segments: [],
    source: "bluesky",
    tags: [topic],
    text: topic,
    upstreamCounts: { likes: 3, quotes: 0, replies: 0, reposts: 0 },
    url: "https://bsky.app",
  };
}
let unavailable = false;
const searchRemote = mock(() => {
  if (unavailable) {
    return Promise.reject(new Error("upstream unavailable"));
  }
  return Promise.resolve({
    posts: [remotePost(techTopic), remotePost(gardenTopic)],
    profiles: [remoteAuthor(techTopic), remoteAuthor(gardenTopic)],
    unavailable: [],
  });
});
mock.module("@/lib/protocols/service", () => ({
  readBlueskyDiscovery: searchRemote,
  readBlueskyPosts: () => Promise.resolve([]),
  readBlueskyProfileResource: () => Promise.resolve(remoteAuthor(techTopic)),
  readBlueskySearch: searchRemote,
}));
// Account-level ranking tests isolate the public query cache, which has its own cross-viewer coverage.
mock.module("./suggestion-public-search", () => ({
  readSuggestionPublicSearch: searchRemote,
}));
const { buildDiscoverySuggestions, readDiscoverySuggestions } =
  await import("./discovery-suggestions");

beforeAll(async () => {
  await Promise.all(
    ids.map((id) =>
      prisma.orm.public.Users.create({
        banned: id === bannedAuthor,
        displayName:
          { [techAuthor]: techTopic, [gardenAuthor]: gardenTopic }[id] ??
          `Fixture ${id}`,
        id,
        username: `suggest-${id}`,
      })
    )
  );
  await Promise.all([
    prisma.orm.public.Follows.create({
      followerId: techViewer,
      followingId: friend,
    }),
    prisma.orm.public.Follows.create({
      followerId: friend,
      followingId: techAuthor,
    }),
    prisma.orm.public.Blocks.create({
      blockedId: blockedAuthor,
      blockerId: techViewer,
    }),
    ...[techAuthor, gardenAuthor, blockedAuthor, bannedAuthor].map(
      (id, index) =>
        prisma.orm.public.Posts.create({
          content: index === 1 ? gardenTopic : techTopic,
          id: postIds[index],
          semanticTags: [index === 1 ? gardenTopic : techTopic],
          userId: id,
        })
    ),
  ]);
  await Promise.all(
    [
      [techViewer, techTopic],
      [gardenViewer, gardenTopic],
    ].map(([viewer, topic]) =>
      saveNetworkPreferences(
        viewer,
        {
          ...defaultNetworkPreferences(),
          language: "all",
          profiles: [{ id: "default", interests: [topic], name: "Everyday" }],
        },
        0
      )
    )
  );
});

afterAll(async () => {
  await prisma.orm.public.Users.where((person) =>
    person.id.in(ids)
  ).deleteAndCount();
  await Promise.all(
    ids.map((id) =>
      redis.del(
        `rec:suggestions:version:${id}`,
        `rec:network:v1:{${id}:default}:signals`,
        `rec:network:v1:{${id}:default}:time`,
        `rec:network:v1:{${id}:default}:dedupe`,
        `rec:network:v1:{${id}:default}:generation`
      )
    )
  );
  await closePrisma();
  redis.disconnect();
});

test("one persona ranks native and Bluesky suggestions together, excludes blocked/banned/followed accounts and credits real mutual follows", async () => {
  const tech = await buildDiscoverySuggestions(
    techViewer,
    AbortSignal.timeout(10_000)
  );
  const garden = await buildDiscoverySuggestions(
    gardenViewer,
    AbortSignal.timeout(10_000)
  );
  expect(new Set(tech.accounts.map((account) => account.source)).size).toBe(2);
  expect(new Set(tech.posts.map((post) => post.source)).size).toBe(2);
  expect(
    tech.accounts.some((account) =>
      [blockedAuthor, bannedAuthor, friend, techViewer].includes(account.id)
    )
  ).toBe(false);
  expect(
    tech.posts.some(
      (post) =>
        post.authorId === blockedAuthor || post.authorId === bannedAuthor
    )
  ).toBe(false);
  expect(
    tech.accounts.find((account) => account.id === techAuthor)?.reason
  ).toBe("Followed by 1 person you follow");
  expect(
    tech.accounts.find((account) => account.source === "bluesky")?.id
  ).toBe(`did:plc:${techTopic}`);
  expect(
    garden.accounts.find((account) => account.source === "bluesky")?.id
  ).toBe(`did:plc:${gardenTopic}`);
  expect(garden.accounts.find((account) => account.source === "asm")?.id).toBe(
    gardenAuthor
  );
});

test("shared reads coalesce and profile learning invalidates the cached recommendation snapshot", async () => {
  searchRemote.mockClear();
  const values = await Promise.all(
    Array.from({ length: 20 }, () =>
      readDiscoverySuggestions(techViewer, AbortSignal.timeout(10_000))
    )
  );
  expect(values.every((value) => value.profileId === "default")).toBe(true);
  const initialCalls = searchRemote.mock.calls.length;
  expect(initialCalls).toBeGreaterThan(0);
  expect(initialCalls).toBeLessThanOrEqual(3);
  await readDiscoverySuggestions(techViewer, AbortSignal.timeout(10_000));
  expect(searchRemote).toHaveBeenCalledTimes(initialCalls);
  await recordNetworkSignal(
    techViewer,
    "default",
    {
      authorId: "",
      createdAt: Date.now(),
      kind: "search",
      tags: [gardenTopic],
    },
    `query-${suffix}`
  );
  await readDiscoverySuggestions(techViewer, AbortSignal.timeout(10_000));
  expect(searchRemote.mock.calls.length).toBeGreaterThan(initialCalls);
});

test("a remote outage retains native recommendations as a partial result", async () => {
  unavailable = true;
  try {
    const result = await buildDiscoverySuggestions(
      techViewer,
      AbortSignal.timeout(10_000)
    );
    expect(result.partial).toBe(true);
    expect(result.accounts.some((account) => account.source === "asm")).toBe(
      true
    );
    expect(result.posts.some((post) => post.source === "asm")).toBe(true);
  } finally {
    unavailable = false;
  }
});
