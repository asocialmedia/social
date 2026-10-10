import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { prisma, toPrismaDateTime } from "@asm/db";

import { followingGustsPage } from "./following";

const ids = {
  amplifier: randomUUID(),
  author: randomUUID(),
  outsider: randomUUID(),
  viewer: randomUUID(),
};
const posts = {
  amplified: randomUUID(),
  authored: randomUUID(),
  fleet: randomUUID(),
  moderated: randomUUID(),
  muted: randomUUID(),
  unrelated: randomUUID(),
};

beforeAll(async () => {
  for (const [name, id] of Object.entries(ids)) {
    // oxlint-disable-next-line no-await-in-loop -- fixture cleanup also handles partial creation
    await prisma.orm.public.Users.create({
      displayName: name,
      email: `${id}@example.invalid`,
      id,
      username: `gust-qa-${id}`,
    });
  }
  for (const followingId of [ids.author, ids.amplifier]) {
    // oxlint-disable-next-line no-await-in-loop -- users must exist before relations
    await prisma.orm.public.Follows.create({
      followerId: ids.viewer,
      followingId,
    });
  }
  let order = 0;
  for (const [kind, id] of Object.entries(posts)) {
    // oxlint-disable-next-line no-await-in-loop -- media below depends on this post
    await prisma.orm.public.Posts.create({
      content: kind,
      createdAt: toPrismaDateTime(new Date(Date.now() - order * 1000)),
      id,
      isGust: kind !== "fleet",
      moderated: kind === "moderated",
      userId:
        kind === "authored" || kind === "moderated" || kind === "fleet"
          ? ids.author
          : ids.outsider,
    });
    order += 1;
    // oxlint-disable-next-line no-await-in-loop -- each fixture media belongs to its post
    await prisma.orm.public.PostMedia.create({
      _type: "VIDEO",
      id: randomUUID(),
      postId: id,
      url: "https://example.invalid/qa.mp4",
    });
  }
  await prisma.orm.public.Votes.create({
    postId: posts.amplified,
    userId: ids.amplifier,
    value: 1,
  });
  await prisma.orm.public.Votes.create({
    postId: posts.muted,
    userId: ids.amplifier,
    value: -1,
  });
});

afterAll(async () => {
  await prisma.orm.public.PostMedia.where((media) =>
    media.postId.in(Object.values(posts))
  ).delete();
  await prisma.orm.public.Users.where((user) =>
    user.id.in(Object.values(ids))
  ).delete();
});

test("Following includes followed authors and positive amplifiers only, with ordered source avatars and exclusive pagination", async () => {
  const options = { excludeModerated: true, pageSize: 1, userId: ids.viewer };
  const first = await followingGustsPage(options);
  expect(first.posts.map((post) => post.id)).toEqual([posts.authored]);
  expect(first.posts[0]?.followingSources?.map((person) => person.id)).toEqual([
    ids.author,
  ]);
  expect(first.nextCursor).toBe(posts.authored);
  const second = await followingGustsPage({
    ...options,
    cursor: first.nextCursor ?? undefined,
  });
  expect(second.posts.map((post) => post.id)).toEqual([posts.amplified]);
  expect(second.posts[0]?.followingSources?.map((person) => person.id)).toEqual(
    [ids.amplifier]
  );
  expect(second.nextCursor).toBeNull();
  const empty = await followingGustsPage({ ...options, userId: ids.outsider });
  expect(empty.posts).toEqual([]);
});
