import { expect, test } from "bun:test";

import {
  feedRenderPolicy,
  mergeUnreadFeedHead,
  reconcileFeedOrder,
} from "./feed-coordinator";

const reading = {
  active: true,
  initialLoading: false,
  offset: 500,
  paging: false,
  pendingHeadCount: 3,
  refreshing: false,
};
test("refresh, initial reads, and tail paging block automatic head admission", () => {
  expect(feedRenderPolicy(reading).admitHead).toBe(true);
  for (const state of [
    { refreshing: true },
    { initialLoading: true },
    { paging: true },
    { active: false },
    { offset: 0 },
  ]) {
    expect(feedRenderPolicy({ ...reading, ...state }).admitHead).toBe(false);
  }
  expect(feedRenderPolicy({ ...reading, refreshing: true }).loadTail).toBe(
    false
  );
});
test("a tail page with newer timestamps still appends; explicit source heads prepend", () => {
  const previous = [{ id: "a" }, { id: "b" }];
  const incoming = [{ id: "new" }, { id: "tail" }, ...previous];
  expect(
    reconcileFeedOrder(previous, incoming, [["new", "a", "b", "tail"]]).map(
      (p) => p.id
    )
  ).toEqual(["new", "a", "b", "tail"]);
});
test("unread notices survive admission, deduplicate polls, and clear independently", () => {
  const unread = mergeUnreadFeedHead(
    [{ id: "new" }],
    [{ id: "new" }, { id: "another" }]
  );
  expect(mergeUnreadFeedHead(unread, [])).toHaveLength(2);
  expect(mergeUnreadFeedHead([], [])).toEqual([]);
});

test("follow controls hide ASM self posts and linked Bluesky self posts", async () => {
  const { canFollowPostAuthor } = await import("./feed-coordinator");
  expect(canFollowPostAuthor({ authorId: "me", viewerId: "me" })).toBe(false);
  expect(
    canFollowPostAuthor({
      authorId: "did:me",
      connectionKnown: true,
      externalDid: "did:me",
      viewerDid: "did:me",
      viewerId: "me",
    })
  ).toBe(false);
  expect(
    canFollowPostAuthor({
      authorId: "did:other",
      externalDid: "did:other",
      viewerId: "me",
    })
  ).toBe(false);
  expect(
    canFollowPostAuthor({
      authorId: "did:other",
      connectionKnown: true,
      externalDid: "did:other",
      viewerDid: "did:me",
      viewerId: "me",
    })
  ).toBe(true);
  expect(canFollowPostAuthor({ authorId: "other" })).toBe(true);
});
