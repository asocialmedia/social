import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { prisma, getUserProfileCounts } from "@asm/db";

import { getProfileUserList } from "./profile-user-list";

const ids = Array.from({ length: 7 }, () => randomUUID());
const [viewer, target, alice, bob, mutualOne, mutualTwo, stranger] = ids;
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("localhost")) {
    throw new Error("Local test database required");
  }
  await prisma.orm.public.Users.createAll(
    ids.map((id) => ({
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: `qa_${id.slice(0, 8)}`,
    }))
  );
  await prisma.orm.public.Follows.createAll([
    { followerId: alice, followingId: target },
    { followerId: bob, followingId: target },
    { followerId: target, followingId: alice },
    { followerId: viewer, followingId: mutualOne },
    { followerId: viewer, followingId: mutualTwo },
    { followerId: viewer, followingId: alice },
    { followerId: mutualOne, followingId: alice },
    { followerId: mutualTwo, followingId: alice },
    { followerId: mutualOne, followingId: bob },
    { followerId: stranger, followingId: bob },
  ]);
});
afterAll(async () => {
  await prisma.orm.public.Users.where((user) =>
    user.id.in(ids)
  ).deleteAndCount();
});
test("followers return counts and only the viewer's genuine mutual connections", async () => {
  const rows = await getProfileUserList(target, viewer, "followers");
  expect(rows.map((row) => row.id).toSorted()).toEqual([alice, bob].toSorted());
  const first = rows.find((row) => row.id === alice);
  expect(first?.mutualCount).toBe(2);
  expect(first?.mutualFollowers.map((user) => user.id).toSorted()).toEqual(
    [mutualOne, mutualTwo].toSorted()
  );
  expect(first?.isFollowing).toBe(true);
  expect(first?._count.followers).toBe(4);
  expect(
    rows.find((row) => row.id === bob)?.mutualFollowers.map((user) => user.id)
  ).toEqual([mutualOne]);
});
test("following and mutuals are scoped to the requested profile and viewer", async () => {
  const rows = await getProfileUserList(target, stranger, "following");
  expect(rows.map((row) => row.id)).toEqual([alice]);
  expect(rows[0]?.isFollowing).toBe(false);
  expect(rows[0]?.mutualCount).toBe(0);
  expect(rows[0]?.mutualFollowers).toEqual([]);
});

test("Bluesky follows appear on the same profile list and total, scoped to the viewer", async () => {
  const did = `did:plc:fixture${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await prisma.orm.public.ExternalAuthors.create({
      did,
      displayName: "External person",
      handle: "external.test",
    });
    await prisma.orm.public.ExternalFollows.create({
      authorDid: did,
      userId: target,
    });
    const rows = await getProfileUserList(target, viewer, "following");
    expect(rows.find((row) => row.id === did)).toMatchObject({
      isFollowing: false,
      source: "bluesky",
      username: "external.test",
    });
    const counts = await getUserProfileCounts(prisma.orm, target);
    expect(counts.following).toBe(2);
    const own = await getProfileUserList(target, target, "following");
    expect(own.find((row) => row.id === did)?.isFollowing).toBe(true);
  } finally {
    await prisma.orm.public.ExternalAuthors.where({ did }).deleteAndCount();
  }
});
