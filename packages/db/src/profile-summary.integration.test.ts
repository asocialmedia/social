import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { getUserProfileSummary } from "./client";
import prisma from "./prisma";

const viewer = randomUUID();
const target = randomUUID();
const mutuals = Array.from({ length: 7 }, () => randomUUID());
const stranger = randomUUID();
const blockedByViewer = randomUUID();
const blocksTarget = randomUUID();
const ids = [
  viewer,
  target,
  ...mutuals,
  stranger,
  blockedByViewer,
  blocksTarget,
];

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("localhost")) {
    throw new Error("Local test database required");
  }
  await prisma.orm.public.Users.createAll(
    ids.map((id) => ({
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: `profile_${id}`,
    }))
  );
  await prisma.orm.public.Follows.createAll([
    ...mutuals.flatMap((id) => [
      { followerId: viewer, followingId: id },
      { followerId: id, followingId: target },
      { followerId: target, followingId: id },
    ]),
    { followerId: stranger, followingId: target },
    { followerId: stranger, followingId: mutuals[0] },
    { followerId: target, followingId: stranger },
    ...[blockedByViewer, blocksTarget].flatMap((id) => [
      { followerId: viewer, followingId: id },
      { followerId: id, followingId: target },
      { followerId: target, followingId: id },
    ]),
  ]);
  await prisma.orm.public.Blocks.createAll([
    { blockedId: blockedByViewer, blockerId: viewer },
    { blockedId: target, blockerId: blocksTarget },
  ]);
  await prisma.orm.public.Posts.createAll([
    {
      content: "Profile count regression one",
      id: randomUUID(),
      userId: target,
    },
    {
      content: "Profile count regression two",
      id: randomUUID(),
      userId: target,
    },
  ]);
});

afterAll(async () => {
  await prisma.orm.public.Users.where((user) =>
    user.id.in(ids)
  ).deleteAndCount();
});

describe("profile totals and viewer-specific mutual previews", () => {
  test("returns actual totals independently of the viewer-filtered follow relation", async () => {
    const summary = await getUserProfileSummary(prisma.orm, target, viewer);
    expect(summary._count).toEqual({ followers: 10, following: 10, posts: 2 });
    const expected = mutuals.toSorted().slice(0, 3);
    expect(summary.mutuals.counts).toEqual({ followers: 7, following: 7 });
    expect(summary.mutuals.followers.map((user) => user.id)).toEqual(expected);
    expect(summary.mutuals.following.map((user) => user.id)).toEqual(expected);
    expect(Object.keys(summary.mutuals.followers[0] ?? {}).toSorted()).toEqual([
      "avatarUrl",
      "displayName",
      "id",
      "username",
    ]);
  });

  test("distinguishes followers in your network from accounts you both follow", async () => {
    const summary = await getUserProfileSummary(prisma.orm, stranger, viewer);
    expect(summary.mutuals.followers).toEqual([]);
    expect(summary.mutuals.following.map((user) => user.id)).toEqual([
      mutuals[0],
    ]);
    const otherViewer = await getUserProfileSummary(
      prisma.orm,
      target,
      stranger
    );
    expect(otherViewer.mutuals.followers.map((user) => user.id)).toEqual([
      mutuals[0],
    ]);
    expect(otherViewer.mutuals.following.map((user) => user.id)).toEqual([
      mutuals[0],
    ]);
  });

  test("keeps totals public while omitting mutuals for guests and the profile owner", async () => {
    const summaries = await Promise.all(
      ["", target].map((viewerId) =>
        getUserProfileSummary(prisma.orm, target, viewerId)
      )
    );
    for (const summary of summaries) {
      expect(summary._count).toEqual({
        followers: 10,
        following: 10,
        posts: 2,
      });
      expect(summary.mutuals).toEqual({
        counts: { followers: 0, following: 0 },
        followers: [],
        following: [],
      });
    }
  });
});
