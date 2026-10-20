import { afterAll, beforeAll, expect, mock, test } from "bun:test";

import { closePrisma, prisma, redis } from "@asm/db";

let viewer = "";
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => (viewer ? { user: { id: viewer } } : null),
}));
const { GET } = await import("./route");
const owner = crypto.randomUUID();
const outsider = crypto.randomUUID();
const communityId = crypto.randomUUID();
const postId = crypto.randomUUID();

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("localhost:5433/asocialmedia")) {
    throw new Error("Local test database required");
  }
  await prisma.orm.public.Users.createAll(
    [owner, outsider].map((id) => ({
      displayName: "Gust privacy fixture",
      id,
      username: `gust-privacy-${id}`,
    }))
  );
  await prisma.orm.public.Communities.create({
    _type: "PRIVATE",
    description: "Private fixture",
    id: communityId,
    name: "Private fixture",
    ownerId: owner,
    slug: `gust-privacy-${communityId}`,
  });
  await prisma.orm.public.CommunityMembers.create({
    communityId,
    role: "OWNER",
    userId: owner,
  });
  await prisma.orm.public.Posts.create({
    aura: 100,
    communityId,
    content: "A private landscape clip",
    id: postId,
    isGust: true,
    userId: owner,
  });
  await prisma.orm.public.PostMedia.create({
    _type: "VIDEO",
    mimeType: "video/mp4",
    postId,
    url: "https://example.test/private.mp4",
    userId: owner,
  });
});

afterAll(async () => {
  await prisma.orm.public.Posts.where({ id: postId }).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([owner, outsider])
  ).deleteAndCount();
  await closePrisma();
  redis.disconnect();
});

test("legacy Gusts and share anchors do not reveal private-community clips to guests or non-members", async () => {
  for (const userId of ["", outsider]) {
    viewer = userId;
    for (const query of ["", `?initialId=${postId}`]) {
      // oxlint-disable-next-line no-await-in-loop -- each request exercises a distinct reader and legacy path.
      const response = await GET(
        new Request(`http://localhost/api/gusts${query}`)
      );
      // oxlint-disable-next-line no-await-in-loop -- consume the preceding response.
      const body = await response.json();
      expect(
        body.posts.some((post: { id: string }) => post.id === postId)
      ).toBe(false);
    }
  }
  viewer = owner;
  const response = await GET(
    new Request(`http://localhost/api/gusts?initialId=${postId}`)
  );
  const body = await response.json();
  expect(body.posts[0]?.id).toBe(postId);
});
