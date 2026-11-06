import { afterAll, beforeAll, expect, mock, test } from "bun:test";

import {
  closePrisma,
  prisma,
  redis,
  upsertExternalPostSnapshot,
} from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";

const userId = crypto.randomUUID();
const uri = `at://did:plc:author/app.bsky.feed.post/${crypto.randomUUID()}`;
const post: ExternalPost = {
  author: {
    displayName: "Author",
    handle: "author.test",
    id: "did:plc:author",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/author.test",
  },
  createdAt: new Date().toISOString(),
  id: uri,
  indexedAt: new Date().toISOString(),
  labels: [],
  languages: ["en"],
  media: [],
  revision: "1",
  segments: [{ text: "Profile fixture" }],
  source: "bluesky",
  text: "Profile fixture",
  upstreamCounts: { likes: 1, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/author.test/post/example",
};
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve({ user: { id: userId } }),
}));
mock.module("./service", () => ({
  readBlueskyPosts: () => Promise.resolve([post]),
}));
const { profileExternalActivity } = await import("./profile-activity");
const { GET: responses } =
  await import("@/app/api/users/[userId]/responses/route");
let externalId = "";
let responseId = "";

beforeAll(async () => {
  await prisma.orm.public.Users.create({
    displayName: "Profile fixture",
    id: userId,
    username: `profile-${userId}`,
  });
  externalId = await upsertExternalPostSnapshot(post);
  await prisma.orm.public.ExternalEngagements.create({
    amplified: true,
    externalPostId: externalId,
    userId,
  });
  await prisma.orm.public.ExternalComments.create({
    content: "An eddie on Bluesky",
    externalPostId: externalId,
    requestId: crypto.randomUUID(),
    userId,
  });
  const response = await prisma.orm.public.Posts.create({
    content: "A Fleet responding to Bluesky",
    externalParentId: externalId,
    userId,
  });
  responseId = response.id;
});

afterAll(async () => {
  await prisma.orm.public.Users.where({ id: userId }).delete();
  if (externalId) {
    await prisma.orm.public.ExternalPosts.where({ id: externalId }).delete();
  }
  await closePrisma();
  redis.disconnect();
});

test("persisted Bluesky amplifications and eddies appear in their profile activity feeds", async () => {
  const amplified = await profileExternalActivity(
    userId,
    userId,
    "amplified",
    new AbortController().signal
  );
  expect(amplified.items[0]?.post?.id).toBe(uri);
  expect(amplified.items[0]?.post?.asm?.amplified).toBe(true);
  const eddies = await profileExternalActivity(
    userId,
    userId,
    "eddies",
    new AbortController().signal
  );
  expect(eddies.items[0]?.comment?.content).toBe("An eddie on Bluesky");
  expect(eddies.items[0]?.post?.id).toBe(uri);
});

test("Responses includes a Fleet whose only parent is a Bluesky reference", async () => {
  const response = await responses(
    new Request("http://localhost/profile/responses"),
    { params: Promise.resolve({ userId }) }
  );
  const page = await response.json();
  expect(response.status).toBe(200);
  expect(page.posts.map((entry: { id: string }) => entry.id)).toContain(
    responseId
  );
  expect(page.posts[0].externalParent.uri).toBe(uri);
});
