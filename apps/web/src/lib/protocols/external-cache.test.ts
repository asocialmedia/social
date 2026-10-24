import { expect, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import {
  applyExternalStateToCaches,
  cachedExternalAuthor,
  patchExternalState,
  optimisticExternalState,
} from "./external-cache";

const uri = "at://did:plc:alice/app.bsky.feed.post/first";
const previous = {
  amplifications: 0,
  amplified: false,
  bookmarked: false,
  comments: 0,
  responses: 0,
};
const next = { ...previous, bookmarked: true, comments: 1 };
const post = { asm: previous, id: uri, source: "bluesky" };

test("optimistic amplify toggles are idempotent, preserve bookmarks and never make counts negative", () => {
  const amplified = optimisticExternalState(previous, {
    action: "amplify",
    active: true,
    uri,
  });
  expect(amplified).toEqual({
    ...previous,
    amplifications: 1,
    amplified: true,
  });
  expect(
    optimisticExternalState(amplified, { action: "amplify", active: true, uri })
  ).toEqual(amplified);
  expect(
    optimisticExternalState(amplified, {
      action: "amplify",
      active: false,
      uri,
    })
  ).toEqual(previous);
  expect(
    optimisticExternalState(previous, { action: "amplify", active: false, uri })
  ).toEqual(previous);
  expect(
    optimisticExternalState(amplified, {
      action: "bookmark",
      active: true,
      uri,
    })
  ).toEqual({ ...amplified, bookmarked: true });
});

test("local mutations survive detail and author detours without replacing feed pages", () => {
  const client = new QueryClient();
  const feed = {
    pageParams: [null],
    pages: [{ cursor: "opaque", items: [post] }],
  };
  const key = ["bluesky-discovery", "latest", "alice", "en-IN"];
  client.setQueryData(key, feed);
  client.setQueryData(["bluesky-discovery", "latest", "bob", "en-IN"], feed);
  client.setQueryData(["external-post", uri, "alice"], post);
  client.setQueryData(
    ["bluesky-author-feed", "did:plc:alice", "posts", "alice"],
    feed
  );
  client.setQueryData(["external-library", "alice", "bookmarks"], {
    pages: [{ items: [{ post, uri }] }],
  });
  applyExternalStateToCaches(client, "alice", uri, next);
  expect(client.getQueryData(key)).toEqual({
    ...feed,
    pages: [{ cursor: "opaque", items: [{ ...post, asm: next }] }],
  });
  expect(client.getQueryData(["external-post", uri, "alice"])).toEqual({
    ...post,
    asm: next,
  });
  expect(
    client.getQueryData([
      "bluesky-author-feed",
      "did:plc:alice",
      "posts",
      "alice",
    ])
  ).toEqual(client.getQueryData(key));
  expect(
    client.getQueryData(["external-library", "alice", "bookmarks"])
  ).toEqual({ pages: [{ items: [{ post: { ...post, asm: next }, uri }] }] });
  expect(
    client.getQueryData(["bluesky-discovery", "latest", "bob", "en-IN"])
  ).toEqual(feed);
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  client.clear();
});

test("unrelated posts keep their reference and native post identities are untouched", () => {
  const native = { id: uri, user: { id: "local" } };
  expect(patchExternalState(native, uri, next)).toBe(native);
  const unrelated = {
    pages: [{ items: [{ ...post, id: `${uri}-different` }] }],
  };
  expect(patchExternalState(unrelated, uri, next)).toBe(unrelated);
});

test("profile navigation can reuse the author already loaded in a feed or hover card", () => {
  const author = {
    displayName: "Alice",
    handle: "alice.bsky.social",
    id: "did:plc:alice",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:alice",
  };
  expect(
    cachedExternalAuthor(
      { pages: [{ items: [{ ...post, author }] }] },
      author.id
    )
  ).toEqual(author);
  expect(cachedExternalAuthor(author, author.handle)).toEqual(author);
  expect(
    cachedExternalAuthor(
      { pages: [{ items: [{ ...post, author }] }] },
      "did:plc:other"
    )
  ).toBeUndefined();
});
