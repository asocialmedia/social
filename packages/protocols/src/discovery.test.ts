// Deliberately exercise rejection of unsafe source links.
// oxlint-disable no-script-url
import { expect, test } from "bun:test";

import { normalizePost } from "./bluesky/normalize";
import { postViewSchema } from "./bluesky/schemas";
import {
  discoveryPageSchema,
  mixFeedItems,
  externalFeedbackSchema,
  externalFeedbackKey,
  filterExternalRecommendations,
  externalReplyTarget,
} from "./discovery";
import { postFixture } from "./testing/fixtures";

const external = normalizePost(postViewSchema.parse(postFixture));

test("responding keeps the canonical external parent and original author preview", () => {
  const target = externalReplyTarget(external);
  expect(target.externalParentUri).toBe(external.id);
  expect(target.content).toBe(external.text);
  expect(target.username).toBe(external.author.handle);
  expect(target.avatarUrl).toBe(external.author.avatarUrl ?? null);
  expect("parentPostId" in target).toBe(false);
});
const options = {
  createdAt: (post: { createdAt: string }) => post.createdAt,
  id: (post: { id: string }) => post.id,
  latest: true,
  source: "all" as const,
};

test("Latest merges source timestamps without manufacturing ASM identities", () => {
  const native = [{ createdAt: "2026-10-15T00:00:00.000Z", id: "local" }];
  const items = mixFeedItems(native, [external], options);
  expect(items.map((item) => item.kind)).toEqual(["bluesky", "asm"]);
  expect(items[0]?.value).toBe(external);
});

test("ranked blending keeps native order and deduplicates external originals", () => {
  const native = [
    { createdAt: "2026-10-10T00:00:00.000Z", id: "a" },
    { createdAt: "2026-10-15T00:00:00.000Z", id: "b" },
  ];
  const rows = mixFeedItems(native, [external, external], {
    ...options,
    latest: false,
  });
  expect(rows.map((row) => row.id)).toEqual([
    "asm:a",
    `bluesky:${external.id}`,
    "asm:b",
  ]);
});

test("source filters exclude the other network", () => {
  const native = [{ createdAt: external.createdAt, id: "local" }];
  expect(
    mixFeedItems(native, [external], { ...options, source: "asm" }).map(
      (item) => item.kind
    )
  ).toEqual(["asm"]);
  expect(
    mixFeedItems(native, [external], { ...options, source: "bluesky" }).map(
      (item) => item.kind
    )
  ).toEqual(["bluesky"]);
});

test("discovery boundary rejects unsafe links and incomplete remote data", () => {
  expect(
    discoveryPageSchema.safeParse({
      cursor: null,
      items: [{ ...external, url: "javascript:alert(1)" }],
      partial: false,
    }).success
  ).toBe(false);
  expect(
    discoveryPageSchema.safeParse({
      cursor: null,
      items: [{ id: external.id }],
      partial: false,
    }).success
  ).toBe(false);
});

test("not-interested feedback filters a post without changing source counts", () => {
  const originalCounts = { ...external.upstreamCounts };
  const next = { ...external, id: `${external.id}2` };
  const feedback = {
    authorId: external.author.id,
    postId: external.id,
    scope: "post" as const,
  };
  const excluded = new Set([externalFeedbackKey(feedback)]);
  expect(filterExternalRecommendations([external, next], excluded)).toEqual([
    next,
  ]);
  expect(external.upstreamCounts).toEqual(originalCounts);
  excluded.delete(externalFeedbackKey(feedback));
  expect(filterExternalRecommendations([external, next], excluded)).toEqual([
    external,
    next,
  ]);
});

test("muting an external author filters their future posts across modes", () => {
  const sameAuthor = { ...external, id: `${external.id}2` };
  const otherAuthor = {
    ...external,
    author: { ...external.author, id: "did:plc:another" },
    id: `${external.id}3`,
  };
  const excluded = new Set([
    externalFeedbackKey({
      authorId: external.author.id,
      postId: external.id,
      scope: "author",
    }),
  ]);
  expect(
    filterExternalRecommendations([external, sameAuthor, otherAuthor], excluded)
  ).toEqual([otherAuthor]);
  expect(filterExternalRecommendations([external], new Set())).toEqual([
    external,
  ]);
});

test("feedback cannot target ASM IDs or unsupported feedback types", () => {
  expect(
    externalFeedbackSchema.safeParse({
      authorId: "did:plc:alice",
      postId: "local-asm-id",
      scope: "post",
    }).success
  ).toBe(false);
  expect(
    externalFeedbackSchema.safeParse({
      authorId: "did:plc:alice",
      postId: "at://did:plc:alice/app.bsky.feed.post/abc",
      scope: "vote",
    }).success
  ).toBe(false);
});
