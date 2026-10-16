import { afterAll, beforeAll, expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import prisma from "../prisma";
import {
  externalComments,
  externalLibrary,
  externalPostId,
  externalPostStates,
  findExternalPost,
  mutateExternalPost,
  refreshExternalPost,
  retainExternalResponse,
  externalResponses,
} from "./external-posts";

const run = crypto.randomUUID();
const userId = `external-reader-${run}`;
const otherId = `external-other-${run}`;
const uris: string[] = [];
function post(suffix: string): ExternalPost {
  const authorId = "did:web:external.test";
  const uri = `at://${authorId}/app.bsky.feed.post/${run}-${suffix}`;
  uris.push(uri);
  return {
    author: {
      displayName: "External",
      handle: "external.test",
      id: authorId,
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/external.test",
    },
    createdAt: "2026-10-16T00:00:00.000Z",
    id: uri,
    indexedAt: "2026-10-16T00:00:00.000Z",
    labels: [],
    languages: [],
    media: [],
    revision: "example-cid",
    segments: [{ text: "Original" }],
    source: "bluesky",
    text: "Original",
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    url: "https://bsky.app/profile/external.test/post/example",
  };
}
beforeAll(async () => {
  for (const id of [userId, otherId]) {
    // oxlint-disable-next-line no-await-in-loop -- fixture accounts are created independently.
    await prisma.orm.public.Users.create({ displayName: id, id, username: id });
  }
});
afterAll(async () => {
  await prisma.orm.public.ExternalPosts.where((row) =>
    row.id.in(uris.map(externalPostId))
  ).delete();
  await prisma.orm.public.Users.where((row) =>
    row.id.in([userId, otherId])
  ).delete();
});

test("browsing state and unknown removals never retain source records", async () => {
  const original = post("read");
  expect(await externalPostStates([original.id], userId)).toEqual(new Map());
  await mutateExternalPost({
    action: "bookmark",
    active: false,
    uri: original.id,
    userId,
  });
  expect(await findExternalPost(original.id)).toBeNull();
});

test("concurrent first interactions deduplicate the reference and preserve both fields", async () => {
  const original = post("race");
  await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      mutateExternalPost({
        action: index % 2 ? "amplify" : "bookmark",
        active: true,
        post: original,
        uri: original.id,
        userId,
      })
    )
  );
  const state = await externalPostStates([original.id], userId);
  expect(state.get(original.id)).toEqual({
    amplifications: 1,
    amplified: true,
    bookmarked: true,
    comments: 0,
    responses: 0,
  });
  const references = await prisma.orm.public.ExternalPosts.where({
    uri: original.id,
  }).all();
  expect(references).toHaveLength(1);
  const library = await externalLibrary(userId, "bookmarks");
  expect(library.items.some((item) => item.uri === original.id)).toBe(true);
});

test("different accounts concurrently retain one canonical source record", async () => {
  const original = post("multi-reader");
  await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      mutateExternalPost({
        action: "amplify",
        active: true,
        post: original,
        uri: original.id,
        userId: index % 2 ? userId : otherId,
      })
    )
  );
  const states = await externalPostStates([original.id], userId);
  expect(states.get(original.id)?.amplifications).toBe(2);
  const references = await prisma.orm.public.ExternalPosts.where({
    uri: original.id,
  }).all();
  expect(references).toHaveLength(1);
});

test("comments are idempotent and another account cannot delete them", async () => {
  const original = post("comments");
  const requestId = crypto.randomUUID();
  const input = {
    action: "comment" as const,
    content: "Local discussion",
    post: original,
    requestId,
    uri: original.id,
    userId,
  };
  await Promise.all(
    Array.from({ length: 12 }, () => mutateExternalPost(input))
  );
  const comments = await externalComments(original.id);
  expect(comments.items).toHaveLength(1);
  const [comment] = comments.items;
  expect(comment?.content).toBe("Local discussion");
  if (!comment) {
    throw new Error("Missing test comment");
  }
  await mutateExternalPost({
    action: "delete_comment",
    commentId: comment.id,
    uri: original.id,
    userId: otherId,
  }).catch(() => null);
  const unchanged = await externalComments(original.id);
  expect(unchanged.items[0]?.deleted).toBe(false);
  await expect(
    mutateExternalPost({ ...input, content: "Altered retry" })
  ).rejects.toMatchObject({ status: 409 });
  await mutateExternalPost({
    action: "delete_comment",
    commentId: comment.id,
    uri: original.id,
    userId,
  });
  const deleted = await externalComments(original.id);
  expect(deleted.items[0]?.deleted).toBe(true);
  expect(deleted.items[0]?.content).toBe("");
});

test("source removal clears its snapshot while local discussion survives", async () => {
  const original = post("removed");
  await mutateExternalPost({
    action: "comment",
    content: "Keep local discussion",
    post: original,
    requestId: crypto.randomUUID(),
    uri: original.id,
    userId,
  });
  await refreshExternalPost(original.id, null);
  const retained = await findExternalPost(original.id);
  expect(retained?.available).toBe(false);
  expect(retained?.snapshot).toBeNull();
  const comments = await externalComments(original.id);
  expect(comments.items[0]?.content).toBe("Keep local discussion");
});

test("fleet responses retain one source, page without duplicates, and survive source removal", async () => {
  const original = post("responses");
  expect(await findExternalPost(original.id)).toBeNull();
  const ids = Array.from({ length: 31 }, () => crypto.randomUUID());
  await prisma.transaction(async (tx) => {
    const externalParentId = await retainExternalResponse(tx, original, userId);
    for (const id of ids) {
      // oxlint-disable-next-line no-await-in-loop -- Fixture rows share a transaction and one source record.
      await tx.orm.public.Posts.create({
        content: "A fleet response",
        embedding: [],
        externalParentId,
        id,
        semanticTags: [],
        userId,
      });
    }
  });
  try {
    const state = await externalPostStates([original.id], userId);
    expect(state.get(original.id)?.responses).toBe(31);
    expect(state.get(original.id)?.comments).toBe(0);
    const first = await externalResponses(original.id, userId);
    expect(first.items).toHaveLength(30);
    expect(first.items[0]?.externalParent?.uri).toBe(original.id);
    expect(first.cursor).not.toBeNull();
    const second = await externalResponses(
      original.id,
      userId,
      first.cursor ?? undefined
    );
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size
    ).toBe(31);
    await refreshExternalPost(original.id, null);
    const preserved = await externalResponses(original.id, userId);
    const removedSource = await findExternalPost(original.id);
    expect(preserved.items).toHaveLength(30);
    expect(removedSource?.snapshot).toBeNull();
  } finally {
    await prisma.orm.public.Posts.where((row) => row.id.in(ids)).deleteAll();
  }
  const stateAfterDeletion = await externalPostStates([original.id], userId);
  expect(stateAfterDeletion.get(original.id)?.responses).toBe(0);
});

test("failed fleet responses roll back source retention", async () => {
  const original = post("response-rollback");
  await expect(
    prisma.transaction(async (tx) => {
      await retainExternalResponse(tx, original, userId);
      throw new Error("Failed publish");
    })
  ).rejects.toThrow("Failed publish");
  expect(await findExternalPost(original.id)).toBeNull();
  await expect(
    prisma.transaction((tx) =>
      retainExternalResponse(
        tx,
        {
          ...original,
          author: { ...original.author, id: "did:web:forged.test" },
        },
        userId
      )
    )
  ).rejects.toMatchObject({ status: 400 });
});

test("forged source identity and banned accounts cannot retain records", async () => {
  const original = post("invalid");
  await expect(
    mutateExternalPost({
      action: "amplify",
      active: true,
      post: {
        ...original,
        author: { ...original.author, id: "did:web:imposter.test" },
      },
      uri: original.id,
      userId,
    })
  ).rejects.toMatchObject({ status: 400 });
  await prisma.orm.public.Users.where({ id: otherId }).update({ banned: true });
  await expect(
    mutateExternalPost({
      action: "bookmark",
      active: true,
      post: original,
      uri: original.id,
      userId: otherId,
    })
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    prisma.transaction((tx) => retainExternalResponse(tx, original, otherId))
  ).rejects.toMatchObject({ status: 403 });
  expect(await findExternalPost(original.id)).toBeNull();
});
