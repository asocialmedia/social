import { afterAll, beforeAll, expect, test } from "bun:test";

import {
  closePrisma,
  networkSocialCandidates,
  prisma,
  redis,
  saveNetworkPreferences,
} from "@asm/db";
import type { PostData } from "@asm/db";
import {
  defaultNetworkPreferences,
  recordPublicSocialEvent,
} from "@asm/protocols/discovery";

import { networkNativeFeed } from "./network-native-feed";

const [viewer = "", friend = "", author = ""] = Array.from({ length: 3 }, () =>
  crypto.randomUUID()
);
const postId = crypto.randomUUID();
const offTopicId = crypto.randomUUID();
const externalId = `social-fixture-${crypto.randomUUID()}`;
const uri = `at://did:plc:socialfixture/app.bsky.feed.post/${crypto.randomUUID()}`;

beforeAll(async () => {
  await Promise.all(
    [viewer, friend, author].map((id) =>
      prisma.orm.public.Users.create({
        displayName: `Social fixture ${id}`,
        id,
        username: `social-${id}`,
      })
    )
  );
  await prisma.orm.public.Follows.create({
    followerId: viewer,
    followingId: friend,
  });
  await Promise.all([
    prisma.orm.public.Posts.create({
      content: "Software development tutorial",
      id: postId,
      semanticTags: ["software"],
      userId: author,
    }),
    prisma.orm.public.Posts.create({
      aura: 1_000_000,
      content: "Politics and election news",
      id: offTopicId,
      semanticTags: ["politics"],
      userId: author,
    }),
    prisma.orm.public.ExternalPosts.create({
      authorId: "did:plc:socialfixture",
      available: true,
      id: externalId,
      source: "bluesky",
      uri,
    }),
  ]);
  await Promise.all([
    prisma.orm.public.Votes.create({ postId, userId: friend, value: 1 }),
    prisma.orm.public.Votes.create({
      postId: offTopicId,
      userId: friend,
      value: 1,
    }),
    prisma.orm.public.ExternalEngagements.create({
      amplified: false,
      bookmarked: true,
      externalPostId: externalId,
      userId: friend,
    }),
  ]);
  await saveNetworkPreferences(
    viewer,
    {
      ...defaultNetworkPreferences(),
      language: "all",
      profiles: [{ id: "default", interests: ["software"], name: "Software" }],
      region: "all",
    },
    0
  );
});

afterAll(async () => {
  await Promise.all(
    [viewer, friend, author].map((id) =>
      prisma.orm.public.Users.where({ id }).delete()
    )
  );
  await prisma.orm.public.ExternalPosts.where({ id: externalId }).delete();
  await closePrisma();
  redis.disconnect();
});

test("followed amplifications carry real attribution but never override the active profile", async () => {
  const social = await networkSocialCandidates(viewer);
  expect(
    social.native.find((entry) => entry.id === postId)?.sources[0]?.id
  ).toBe(friend);
  expect(social.external).toEqual([]);
  const response = await networkNativeFeed(
    new Request("http://localhost/feed"),
    viewer,
    "personalized"
  );
  const page: { posts: PostData[] } = await response.json();
  expect(response.status).toBe(200);
  expect(
    page.posts.find((post) => post.id === postId)?.recommendationSources?.[0]
      ?.id
  ).toBe(friend);
  expect(page.posts.some((post) => post.id === offTopicId)).toBe(false);
});

test("Bluesky amplification is eligible while a bookmark stays private; Undo retracts it", async () => {
  await prisma.orm.public.ExternalEngagements.where({
    externalPostId: externalId,
    userId: friend,
  }).update({ amplified: true });
  const social = await networkSocialCandidates(viewer);
  const sourceEntry = social.external.find((entry) => entry.id === uri);
  expect(sourceEntry?.sources[0]?.id).toBe(friend);
  const weight = social.external[0]?.weight;
  expect(weight).toBeGreaterThan(0);
  await prisma.orm.public.ExternalEngagements.where({
    externalPostId: externalId,
    userId: friend,
  }).update({ amplified: false });
  const retracted = await networkSocialCandidates(viewer);
  expect(retracted.external).toEqual([]);
});

test("mutual follows enable the reverse direction and a block removes social amplification", async () => {
  const initialFriend = await networkSocialCandidates(friend);
  expect(initialFriend.native).toEqual([]);
  await prisma.orm.public.Follows.create({
    followerId: friend,
    followingId: viewer,
  });
  await prisma.orm.public.Votes.create({ postId, userId: viewer, value: 1 });
  const reverse = await networkSocialCandidates(friend);
  expect(
    reverse.native.find((entry) => entry.id === postId)?.sources[0]?.id
  ).toBe(viewer);
  await prisma.orm.public.Blocks.create({
    blockedId: friend,
    blockerId: viewer,
  });
  const blockedViewer = await networkSocialCandidates(viewer);
  const blockedFriend = await networkSocialCandidates(friend);
  expect(blockedViewer.native).toEqual([]);
  expect(blockedFriend.native).toEqual([]);
});

test("public Bluesky likes follow the actual ASM-owned edge and disappear after unfollow", async () => {
  const did =
    `did:plc:social${crypto.randomUUID().replaceAll("-", "")}` as const;
  try {
    await prisma.orm.public.ExternalAuthors.create({
      did,
      displayName: "Public actor",
      handle: "public.test",
    });
    await prisma.orm.public.ExternalFollows.create({
      authorDid: did,
      userId: viewer,
    });
    await recordPublicSocialEvent(redis, {
      commit: {
        collection: "app.bsky.feed.like",
        operation: "create",
        record: { subject: { uri } },
        rkey: "likefixture",
      },
      did,
      kind: "commit",
      seq: 10,
      time: new Date().toISOString(),
    });
    const recommended = await networkSocialCandidates(viewer);
    expect(
      recommended.external.find((entry) => entry.id === uri)?.sources[0]
    ).toMatchObject({ action: "like", id: did });
    const unrelated = await networkSocialCandidates(author);
    expect(unrelated.external.some((entry) => entry.id === uri)).toBe(false);
    await prisma.orm.public.ExternalFollows.where({
      authorDid: did,
      userId: viewer,
    }).deleteAndCount();
    const unfollowed = await networkSocialCandidates(viewer);
    expect(unfollowed.external.some((entry) => entry.id === uri)).toBe(false);
  } finally {
    await prisma.orm.public.ExternalAuthors.where({ did }).deleteAndCount();
    await redis.del(
      `asm:public-social:v1:{${did}}`,
      `asm:public-social:v1:{${did}}:time`
    );
  }
});
