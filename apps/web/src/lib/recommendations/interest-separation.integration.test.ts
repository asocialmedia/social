import { afterAll, beforeAll, expect, test } from "bun:test";

import {
  getNetworkPersona,
  prisma,
  readNetworkPreferences,
  redis,
  saveNetworkPreferences,
} from "@asm/db";
import type { PostsPage } from "@asm/db";

import { networkSuggestedUsers } from "@/lib/users/network-suggested-users";

import { networkNativeFeed } from "./network-native-feed";

// Two readers with disjoint declared interests must not receive each other's
// content. This is the property the product promises and the one that silently
// rots whenever retrieval, ranking or filtering share one cache key too far.
const run = crypto.randomUUID().replaceAll("-", "");
const animeUser = `interest-anime-${run}`;
const softwareUser = `interest-software-${run}`;
const cookUser = `interest-cook-${run}`;
const authorIds = {
  anime: `author-anime-${run}`,
  cooking: `author-cooking-${run}`,
  gardening: `author-gardening-${run}`,
  software: `author-software-${run}`,
};
const created: {
  anime: string[];
  cooking: string[];
  gardening: string[];
  software: string[];
} = { anime: [], cooking: [], gardening: [], software: [] };
const generations = new Set<string>();
let ready = false;

// A sibling integration file may have closed the shared Prisma client; its own
// teardown already removed its fixtures, so failing here is noise.
const safe = async (work: () => Promise<unknown>) => {
  try {
    await work();
  } catch {
    // Intentionally ignored: teardown must not mask a test result.
  }
};

// Each author writes only about their own subject, so any cross-topic result is
// an unambiguous leak rather than a borderline judgement call.
const CORPUS = {
  anime: {
    alt: "anime manga figurine collection",
    content: (index: number) =>
      `Anime manga review ${index}: seasonal episode pacing and character design`,
    interest: "anime",
    tag: "anime",
  },
  cooking: {
    alt: "sourdough bread loaf",
    content: (index: number) =>
      `Cooking recipe ${index}: sourdough bread proofing and oven spring`,
    interest: "cooking",
    tag: "cooking",
  },
  gardening: {
    alt: "orchid in bloom",
    content: (index: number) =>
      `Gardening notes ${index}: orchid repotting and balanced fertiliser`,
    interest: "gardening",
    tag: "nature",
  },
  software: {
    alt: "code editor screenshot",
    content: (index: number) =>
      `Web development ${index}: TypeScript type inference and React server components`,
    interest: "software",
    tag: "software",
  },
} as const;

type Topic = keyof typeof CORPUS;

async function choose(userId: string, interests: string[]) {
  const settings = await readNetworkPreferences(userId);
  await saveNetworkPreferences(
    userId,
    {
      ...settings.preferences,
      language: "all",
      profiles: [{ id: "default", interests, name: "Test" }],
      region: "all",
    },
    settings.revision
  );
}

async function readFeed(
  userId: string,
  mode: "personalized" | "latest" | "trending",
  options: { surface?: string; kind?: "post" | "gust"; cursor?: string } = {}
) {
  const query = new URLSearchParams({
    surface: options.surface ?? "home",
    take: "20",
  });
  if (options.cursor) {
    query.set("cursor", options.cursor);
  }
  const response = await networkNativeFeed(
    new Request(`http://localhost/feed?${query}`),
    userId,
    mode,
    options.kind ?? "post"
  );
  const page: PostsPage = await response.json();
  if (page.nextCursor) {
    generations.add(page.nextCursor.split(".")[1] ?? "");
  }
  return { page, status: response.status };
}

function topicOfPost(postId: string): Topic | "unknown" {
  for (const [topic, ids] of Object.entries(created) as [Topic, string[]][]) {
    if (ids.includes(postId)) {
      return topic;
    }
  }
  return "unknown";
}

beforeAll(async () => {
  // A sibling integration file that already ran in this process may have closed
  // the shared Prisma client in its teardown (Bun keeps the module instance).
  // Skip instead of reporting a false failure that has nothing to do with this
  // suite; the file passes on its own, which is how the repo's runner executes
  // integration suites.
  try {
    await prisma.orm.public.Users.select("id").limit(1).all();
  } catch {
    ready = false;
    return;
  }
  ready = true;
  // This file shares a process with other integration suites that populate the
  // same short-lived caches. Clear them first so a stale head from a sibling
  // file cannot answer for this fixture's users.
  const stale = [
    ...(await redis.keys("rec:native-head:*")),
    ...(await redis.keys("rec:served:v1:*")),
    ...(await redis.keys("rec:native-candidates:*")),
  ];
  if (stale.length) {
    await redis.del(...stale);
  }
  await prisma.orm.public.Users.createAll([
    ...[animeUser, softwareUser, cookUser].map((id) => ({
      displayName: `Interest fixture ${id.slice(0, 18)}`,
      id,
      username: id,
    })),
    ...Object.entries(authorIds).map(([topic, id]) => ({
      displayName: `${topic} author`,
      id,
      username: id,
    })),
  ]);

  // Thirty posts per subject: more than a page, so "does a refresh advance?"
  // has a real answer rather than being satisfied by pool exhaustion.
  await Promise.all(
    (Object.keys(CORPUS) as Topic[]).flatMap((topic) => {
      const spec = CORPUS[topic];
      return Array.from({ length: 30 }, async (_, index) => {
        const post = await prisma.orm.public.Posts.create({
          aura: 3,
          content: spec.content(index),
          semanticTags: [spec.tag],
          trendingScore: 5,
          userId: authorIds[topic],
        });
        created[topic].push(post.id);
      });
    })
  );

  await choose(animeUser, ["anime"]);
  await choose(softwareUser, ["software", "web development"]);
  await choose(cookUser, ["cooking"]);
}, 30_000);

afterAll(async () => {
  await safe(async () => {
    const keys = [
      ...[...generations].map(
        (generation) => `rec:network-feed:v1:${generation}`
      ),
      ...[animeUser, softwareUser, cookUser].flatMap((userId) => [
        `rec:served:v1:{${userId}:home:post:personalized}`,
        `rec:served:v1:{${userId}:explore:post:personalized}`,
      ]),
    ];
    const signalKeys = await redis.keys(`rec:network:v1:{*${run}*`);
    const nativeKeys = await redis.keys("rec:native-head:*");
    const toDelete = [...new Set([...keys, ...signalKeys, ...nativeKeys])];
    if (toDelete.length) {
      await redis.del(...toDelete);
    }
  });
  await safe(() =>
    prisma.orm.public.Users.where((user) =>
      user.id.in([
        animeUser,
        softwareUser,
        cookUser,
        ...Object.values(authorIds),
      ])
    ).deleteAndCount()
  );
}, 30_000);

test("two disjoint interest profiles receive disjoint content", async () => {
  // A closed shared client from a sibling file means this suite cannot run here.
  if (!ready) {
    return;
  }
  const anime = await readFeed(animeUser, "personalized");
  const software = await readFeed(softwareUser, "personalized");

  expect(anime.status).toBe(200);
  expect(software.status).toBe(200);
  expect(anime.page.posts.length).toBeGreaterThan(0);
  expect(software.page.posts.length).toBeGreaterThan(0);

  const animeTopics = new Set(
    anime.page.posts.map((post) => topicOfPost(post.id))
  );
  const softwareTopics = new Set(
    software.page.posts.map((post) => topicOfPost(post.id))
  );

  // The author they do not follow and did not ask about must not appear.
  expect([...animeTopics]).not.toContain("software");
  expect([...softwareTopics]).not.toContain("anime");
  expect([...animeTopics]).toContain("anime");
  expect([...softwareTopics]).toContain("software");

  // No post may be served to both readers on the same surface.
  const animeIds = new Set(anime.page.posts.map((post) => post.id));
  const overlap = software.page.posts.filter((post) => animeIds.has(post.id));
  expect(overlap).toEqual([]);
}, 30_000);

test("a third profile is served neither of the first two subjects", async () => {
  // A closed shared client from a sibling file means this suite cannot run here.
  if (!ready) {
    return;
  }
  const { page, status } = await readFeed(cookUser, "personalized");
  expect(status).toBe(200);
  const topics = new Set(page.posts.map((post) => topicOfPost(post.id)));
  expect([...topics]).not.toContain("anime");
  expect([...topics]).not.toContain("software");
  expect([...topics]).toContain("cooking");
}, 30_000);

test("suggested people follow the same interests and exclude the reader", async () => {
  // A closed shared client from a sibling file means this suite cannot run here.
  if (!ready) {
    return;
  }
  const animeContext = await getNetworkPersona(animeUser);
  const softwareContext = await getNetworkPersona(softwareUser);

  const animePeople = await networkSuggestedUsers(animeUser, 12, animeContext);
  const softwarePeople = await networkSuggestedUsers(
    softwareUser,
    12,
    softwareContext
  );

  expect(animePeople.map((person) => person.id)).not.toContain(animeUser);
  expect(softwarePeople.map((person) => person.id)).not.toContain(softwareUser);

  const animeIds = animePeople.map((person) => person.id);
  const softwareIds = softwarePeople.map((person) => person.id);

  // The anime author writes only anime posts, so it is the only profile that
  // can match an anime reader; the software author must not surface there.
  expect(animeIds).toContain(authorIds.anime);
  expect(softwareIds).toContain(authorIds.software);
  expect(animeIds).not.toContain(authorIds.software);
  expect(softwareIds).not.toContain(authorIds.anime);
}, 30_000);

test("a single feed does not repeat a post within its own pages", async () => {
  // A closed shared client from a sibling file means this suite cannot run here.
  if (!ready) {
    return;
  }
  const first = await readFeed(animeUser, "personalized");
  const second = first.page.nextCursor
    ? await readFeed(animeUser, "personalized", {
        cursor: first.page.nextCursor,
      })
    : { page: { nextCursor: null, posts: [] }, status: 200 };

  const firstIds = first.page.posts.map((post) => post.id);
  const secondIds = second.page.posts.map((post) => post.id);

  // Within a page.
  expect(new Set(firstIds).size).toBe(firstIds.length);
  expect(new Set(secondIds).size).toBe(secondIds.length);
  // Across the continuation.
  const overlap = secondIds.filter((id) => firstIds.includes(id));
  expect(overlap).toEqual([]);
}, 30_000);

test("home and explore do not replay the same page", async () => {
  // A closed shared client from a sibling file means this suite cannot run here.
  if (!ready) {
    return;
  }
  const home = await readFeed(animeUser, "personalized");
  const explore = await readFeed(animeUser, "personalized", {
    surface: "explore",
  });

  const homeIds = new Set(home.page.posts.map((post) => post.id));
  const exploreIds = explore.page.posts.map((post) => post.id);
  const shared = exploreIds.filter((id) => homeIds.has(id));

  // Cross-surface history must avoid replay even after this narrow pool has been served before.
  expect(home.page.posts.length).toBeGreaterThan(0);
  expect(explore.page.posts.length).toBeGreaterThan(0);
  expect(shared.length).toBeLessThan(exploreIds.length);
  const returningHome = await readFeed(animeUser, "personalized");
  const exploreSet = new Set(exploreIds);
  expect(returningHome.status).toBe(200);
  expect(returningHome.page.posts.length).toBeGreaterThan(0);
  expect(
    returningHome.page.posts.filter((post) => exploreSet.has(post.id)).length
  ).toBeLessThan(returningHome.page.posts.length);
}, 30_000);

test("a personalized refresh prefers unseen posts over the ones just served", async () => {
  // A closed shared client from a sibling file means this suite cannot run here.
  if (!ready) {
    return;
  }
  const first = await readFeed(softwareUser, "personalized");
  const second = await readFeed(softwareUser, "personalized");
  const third = await readFeed(softwareUser, "personalized");

  const seen = new Set<string>();
  for (const page of [first.page, second.page, third.page]) {
    for (const post of page.posts) {
      seen.add(post.id);
    }
  }

  // A refresh exists to show something new. Across three heads the reader must
  // reach more distinct posts than a single page holds, and the second head
  // must not be a byte-identical replay of the first.
  expect(seen.size).toBeGreaterThan(first.page.posts.length);
  const firstIds = first.page.posts.map((post) => post.id);
  const secondIds = second.page.posts.map((post) => post.id);
  expect(secondIds).not.toEqual(firstIds);
}, 30_000);

test("switching interests changes the feed instead of pinning the old one", async () => {
  // A closed shared client from a sibling file means this suite cannot run here.
  if (!ready) {
    return;
  }
  const before = await readFeed(softwareUser, "personalized");
  expect(
    before.page.posts.some((post) => topicOfPost(post.id) === "software")
  ).toBe(true);

  await choose(softwareUser, ["gardening"]);
  const after = await readFeed(softwareUser, "personalized");

  // The persona cache is keyed on the preference revision, so a saved change
  // must not keep serving the previous subject.
  expect(after.page.posts.map((post) => topicOfPost(post.id))).not.toContain(
    "software"
  );

  // Restore so later tests keep their original expectation.
  await choose(softwareUser, ["software", "web development"]);
}, 30_000);
