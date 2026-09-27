import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SEED_CONFIG,
  buildSeedPlan,
  countPlanRows,
  createRng,
  isSeedId,
  resolveSeedConfig,
} from "./dev-seed-lib";
import type { SeedPlan } from "./dev-seed-lib";

const NOW = new Date("2026-09-26T12:00:00.000Z");

// Small enough to stay fast, shaped like the real config so the structural
// guarantees are exercised against a non-trivial graph.
const TINY = {
  bookmarks: 12,
  commentReplies: 9,
  commentVotes: 7,
  comments: 25,
  communities: 4,
  communityMembers: 15,
  communityPostShares: 5,
  communitySubscriptions: 8,
  follows: 30,
  mentions: 20,
  postTags: 25,
  postVisits: 10,
  posts: 60,
  responses: 20,
  tags: 12,
  users: 25,
  votes: 40,
} as const;

function plan(overrides = {}): SeedPlan {
  return buildSeedPlan({ ...TINY, ...overrides }, { now: NOW });
}

describe("createRng", () => {
  test("is deterministic for a seed and diverges across seeds", () => {
    const first = Array.from({ length: 8 }, () => createRng(7).int(0, 1000));
    const same = Array.from({ length: 8 }, () => createRng(7).int(0, 1000));
    const other = createRng(8).int(0, 1000);
    expect(first).toEqual(same);
    expect(first).not.toContain(other);
  });

  test("stays inside the requested bounds", () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const value = rng.int(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(9);
    }
  });
});

describe("resolveSeedConfig", () => {
  test("floors negative and fractional counts instead of passing them on", () => {
    const resolved = resolveSeedConfig({ posts: -5, comments: 12.9 });
    expect(resolved.posts).toBe(0);
    expect(resolved.comments).toBe(12);
  });

  test("keeps at least one day of window", () => {
    expect(resolveSeedConfig({ windowDays: 0 }).windowDays).toBe(1);
  });

  test("defaults to a gust-free corpus", () => {
    expect(DEFAULT_SEED_CONFIG.gusts).toBe(0);
  });
});

describe("buildSeedPlan determinism", () => {
  test("the same config produces an identical plan", () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  test("a different seed produces different content", () => {
    const a = plan();
    const b = plan({ seed: 99 });
    expect(a.posts[0]?.content).not.toBe(b.posts[0]?.content);
  });
});

describe("buildSeedPlan ids", () => {
  test("every id is namespaced so --fresh can find them", () => {
    const built = plan();
    const ids = [
      ...built.users.map((row) => row.id),
      ...built.posts.map((row) => row.id),
      ...built.responses.map((row) => row.id),
      ...built.comments.map((row) => row.id),
      ...built.commentReplies.map((row) => row.id),
      ...built.communities.map((row) => row.id),
      ...built.tags.map((row) => row.id),
      ...built.bookmarks.map((row) => row.id),
      ...built.postVisits.map((row) => row.id),
      ...built.mentions.map((row) => row.id),
      ...built.communityMembers.map((row) => row.id),
      ...built.communitySubscriptions.map((row) => row.id),
      ...built.communityPostShares.map((row) => row.id),
      ...built.auraLogs.map((row) => row.id),
    ];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(isSeedId(id)).toBe(true);
    }
  });

  test("isSeedId only claims the seeder's own namespace", () => {
    expect(isSeedId("seed-user-1")).toBe(true);
    expect(isSeedId("4d2b8029-5361-4cc1-a816-a730c00e86ed")).toBe(false);
    expect(isSeedId("sys-zeph")).toBe(false);
  });
});

describe("buildSeedPlan unique constraints", () => {
  test("usernames are unique and dodge the ones already taken", () => {
    const built = plan();
    const usernames = built.users.map((row) => row.username.toLowerCase());
    expect(new Set(usernames).size).toBe(usernames.length);

    const reserved = new Set([usernames[0] ?? ""]);
    const rebuilt = buildSeedPlan(TINY, {
      now: NOW,
      reservedUsernames: reserved,
    });
    const rebuiltNames = rebuilt.users.map((row) => row.username.toLowerCase());
    expect(new Set(rebuiltNames).size).toBe(rebuiltNames.length);
    for (const username of rebuiltNames) {
      expect(reserved.has(username)).toBe(false);
    }
  });

  test("community names and slugs are unique", () => {
    const built = plan();
    const names = built.communities.map((row) => row.name.toLowerCase());
    const slugs = built.communities.map((row) => row.slug);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("community slugs match the /^[a-z0-9_]+$/ rule the router enforces", () => {
    for (const community of plan().communities) {
      expect(community.slug).toMatch(/^[a-z0-9_]+$/);
      expect(community.slug.length).toBeLessThanOrEqual(21);
    }
  });

  test("tag names are unique", () => {
    const names = plan().tags.map((row) => row.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("one vote, bookmark and visit per (user, target)", () => {
    const built = plan();
    const voteKeys = built.votes.map((v) => `${v.userId}:${v.postId}`);
    expect(new Set(voteKeys).size).toBe(voteKeys.length);

    const bookmarkKeys = built.bookmarks.map((b) => `${b.userId}:${b.postId}`);
    expect(new Set(bookmarkKeys).size).toBe(bookmarkKeys.length);

    const visitKeys = built.postVisits.map((v) => `${v.userId}:${v.postId}`);
    expect(new Set(visitKeys).size).toBe(visitKeys.length);

    const commentVoteKeys = built.commentVotes.map(
      (v) => `${v.userId}:${v.commentId}`
    );
    expect(new Set(commentVoteKeys).size).toBe(commentVoteKeys.length);
  });

  test("one membership and subscription per (community, user)", () => {
    const built = plan();
    const memberKeys = built.communityMembers.map(
      (m) => `${m.communityId}:${m.userId}`
    );
    expect(new Set(memberKeys).size).toBe(memberKeys.length);
    const subKeys = built.communitySubscriptions.map(
      (s) => `${s.communityId}:${s.userId}`
    );
    expect(new Set(subKeys).size).toBe(subKeys.length);
  });

  test("a community shares each post at most once", () => {
    const postIds = plan().communityPostShares.map((share) => share.postId);
    expect(new Set(postIds).size).toBe(postIds.length);
  });

  test("one mention per (post, user)", () => {
    const keys = plan().mentions.map((m) => `${m.postId}:${m.userId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("one tag link per (post, tag)", () => {
    const keys = plan().postTags.map((t) => `${t.postId}:${t.tagId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("nobody votes, bookmarks or visits their own post", () => {
    const built = plan();
    const authorOf = new Map(
      [...built.posts, ...built.responses, ...built.gusts].map((post) => [
        post.id,
        post.userId,
      ])
    );
    for (const vote of built.votes) {
      expect(vote.userId).not.toBe(authorOf.get(vote.postId));
    }
    for (const bookmark of built.bookmarks) {
      expect(bookmark.userId).not.toBe(authorOf.get(bookmark.postId));
    }
    for (const visit of built.postVisits) {
      expect(visit.userId).not.toBe(authorOf.get(visit.postId));
    }
  });

  test("nobody votes on their own comment", () => {
    const built = plan();
    const authorOf = new Map(
      [...built.comments, ...built.commentReplies].map((comment) => [
        comment.id,
        comment.userId,
      ])
    );
    for (const vote of built.commentVotes) {
      expect(vote.userId).not.toBe(authorOf.get(vote.commentId));
    }
  });

  test("nobody follows themselves", () => {
    for (const follow of plan().follows) {
      expect(follow.followerId).not.toBe(follow.followingId);
    }
  });

  test("a post never mentions its own author", () => {
    const built = plan();
    const authorOf = new Map(
      [...built.posts, ...built.responses].map((post) => [post.id, post.userId])
    );
    for (const mention of built.mentions) {
      expect(mention.userId).not.toBe(authorOf.get(mention.postId));
    }
  });
});

describe("buildSeedPlan referential integrity", () => {
  test("every foreign key points at a row in the plan", () => {
    const built = plan();
    const userIds = new Set(built.users.map((row) => row.id));
    const postIds = new Set(
      [...built.posts, ...built.responses, ...built.gusts].map((row) => row.id)
    );
    const communityIds = new Set(built.communities.map((row) => row.id));
    const tagIds = new Set(built.tags.map((row) => row.id));
    const commentIds = new Set(
      [...built.comments, ...built.commentReplies].map((row) => row.id)
    );

    for (const post of [...built.posts, ...built.responses, ...built.gusts]) {
      expect(userIds.has(post.userId)).toBe(true);
      if (post.parentPostId !== null) {
        expect(postIds.has(post.parentPostId)).toBe(true);
      }
      if (post.communityId !== null) {
        expect(communityIds.has(post.communityId)).toBe(true);
      }
    }
    for (const comment of [...built.comments, ...built.commentReplies]) {
      expect(userIds.has(comment.userId)).toBe(true);
      expect(postIds.has(comment.postId)).toBe(true);
      if (comment.parentId !== null) {
        expect(commentIds.has(comment.parentId)).toBe(true);
      }
      if (comment.rootId !== null) {
        expect(commentIds.has(comment.rootId)).toBe(true);
      }
    }
    for (const community of built.communities) {
      expect(userIds.has(community.ownerId)).toBe(true);
    }
    for (const member of built.communityMembers) {
      expect(communityIds.has(member.communityId)).toBe(true);
      expect(userIds.has(member.userId)).toBe(true);
    }
    for (const subscription of built.communitySubscriptions) {
      expect(communityIds.has(subscription.communityId)).toBe(true);
      expect(userIds.has(subscription.userId)).toBe(true);
    }
    for (const share of built.communityPostShares) {
      expect(communityIds.has(share.communityId)).toBe(true);
      expect(postIds.has(share.postId)).toBe(true);
      expect(postIds.has(share.sourcePostId)).toBe(true);
    }
    for (const link of built.postTags) {
      expect(postIds.has(link.postId)).toBe(true);
      expect(tagIds.has(link.tagId)).toBe(true);
    }
    for (const log of built.auraLogs) {
      expect(userIds.has(log.userId)).toBe(true);
      expect(userIds.has(log.issuerId)).toBe(true);
    }
  });

  test("every community has exactly one OWNER membership", () => {
    const built = plan();
    for (const community of built.communities) {
      const owners = built.communityMembers.filter(
        (member) =>
          member.communityId === community.id && member.role === "OWNER"
      );
      expect(owners).toHaveLength(1);
      expect(owners[0]?.userId).toBe(community.ownerId);
    }
  });
});

describe("buildSeedPlan threading", () => {
  test("root fleets carry no parent and no root pointer", () => {
    for (const post of plan().posts) {
      expect(post.parentPostId).toBeNull();
      expect(post.rootPostId).toBeNull();
      expect(post.threadTopId).toBeNull();
    }
  });

  test("responses point at a parent and repeat it as the thread root", () => {
    const built = plan();
    const known = new Set(built.posts.map((row) => row.id));
    for (const response of built.responses) {
      expect(response.parentPostId).not.toBeNull();
      expect(response.rootPostId).toBe(response.parentPostId);
      expect(response.threadTopId).toBe(response.parentPostId);
      expect(known.has(response.parentPostId ?? "")).toBe(true);
    }
  });

  test("a response is never older than the post it answers", () => {
    for (const response of plan().responses) {
      expect(response.createdAt.getTime()).toBeGreaterThanOrEqual(0);
    }
    const built = plan();
    const byId = new Map(built.posts.map((row) => [row.id, row]));
    for (const response of built.responses) {
      const parent = byId.get(response.parentPostId ?? "");
      if (parent) {
        expect(response.createdAt.getTime()).toBeGreaterThanOrEqual(
          parent.createdAt.getTime()
        );
      }
    }
  });

  test("fleet timestamps are unique and never bunched together", () => {
    // The feed paginates on createdAt, so identical stamps would let a cursor
    // skip or repeat rows, and a bunched-up run would not read like a feed at
    // all. The rows are grouped by kind in the array, so this checks the
    // timestamps themselves rather than the order they were built in.
    const stamps = plan()
      .posts.map((post) => post.createdAt.getTime())
      .toSorted((a, b) => b - a);
    expect(new Set(stamps).size).toBe(stamps.length);
    for (let index = 1; index < stamps.length; index++) {
      const gap = (stamps[index - 1] ?? 0) - (stamps[index] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(60_000);
    }
  });

  test("no two rows the feed pages over share a createdAt", () => {
    // Roots, responses and gusts are all one ordered feed; a tie anywhere in it
    // can make a createdAt cursor skip or repeat a row. Comments live in their
    // own table and are paged per post, so they are not part of this.
    const built = plan();
    const stamps = [...built.posts, ...built.responses, ...built.gusts].map(
      (post) => post.createdAt.getTime()
    );
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  test("no two fleets share a timestamp, so a cursor page is stable", () => {
    const built = buildSeedPlan(
      { ...TINY, posts: 200, responses: 0, comments: 0, commentReplies: 0 },
      { now: NOW }
    );
    const stamps = built.posts.map((post) => post.createdAt.getTime());
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  test("top level eddies have no parent, replies carry both pointers", () => {
    const built = plan();
    for (const comment of built.comments) {
      expect(comment.parentId).toBeNull();
      expect(comment.rootId).toBeNull();
    }
    const topLevel = new Set(built.comments.map((row) => row.id));
    for (const reply of built.commentReplies) {
      expect(reply.parentId).not.toBeNull();
      expect(topLevel.has(reply.rootId ?? "")).toBe(true);
    }
  });
});

describe("buildSeedPlan aura ledger", () => {
  test("a user aura equals the sum of the logs credited to them", () => {
    const built = plan();
    const expected = new Map<string, number>();
    for (const log of built.auraLogs) {
      expected.set(log.userId, (expected.get(log.userId) ?? 0) + log.amount);
    }
    for (const user of built.users) {
      expect(user.aura).toBe(expected.get(user.id) ?? 0);
    }
  });

  test("a post aura equals the sum of the logs attached to it", () => {
    const built = plan();
    const expected = new Map<string, number>();
    for (const log of built.auraLogs) {
      if (log.postId !== null) {
        expected.set(log.postId, (expected.get(log.postId) ?? 0) + log.amount);
      }
    }
    for (const post of [...built.posts, ...built.responses, ...built.gusts]) {
      expect(post.aura).toBe(expected.get(post.id) ?? 0);
    }
  });

  test("a comment's aura is its creation and received shares plus its votes", () => {
    const built = plan();
    for (const comment of [...built.comments, ...built.commentReplies]) {
      // Comment votes land on the comment too, so aura is at least the
      // creation plus received shares rather than exactly them.
      expect(comment.aura).toBeGreaterThanOrEqual(
        comment.creationAura + comment.receivedAura
      );
      // The post author's share can never exceed what the comment received.
      expect(comment.postReceivedAura).toBeLessThanOrEqual(
        comment.receivedAura
      );
    }
  });

  test("every post is credited its own creation aura", () => {
    const built = plan();
    const created = new Set(
      built.auraLogs
        .filter((log) => log.type === "POST_CREATION")
        .map((log) => log.postId)
    );
    for (const post of [...built.posts, ...built.responses, ...built.gusts]) {
      expect(created.has(post.id)).toBe(true);
    }
  });
});

describe("buildSeedPlan content", () => {
  test("no post or comment body is empty", () => {
    const built = plan();
    for (const post of [...built.posts, ...built.gusts, ...built.responses]) {
      expect(post.content.trim().length).toBeGreaterThan(10);
    }
    for (const comment of [...built.comments, ...built.commentReplies]) {
      expect(comment.content.trim().length).toBeGreaterThan(5);
    }
  });

  test("bodies read as prose, not as unfilled templates", () => {
    for (const post of plan().posts) {
      expect(post.content).not.toContain("{");
    }
  });

  test("a mention in the body has a Mentions row and vice versa", () => {
    const built = plan();
    const authorOf = new Map(
      [...built.posts, ...built.responses].map((post) => [post.id, post])
    );
    const handleOf = new Map(
      built.users.map((user) => [user.id, user.username] as const)
    );
    for (const mention of built.mentions) {
      const post = authorOf.get(mention.postId);
      const handle = handleOf.get(mention.userId);
      expect(post).toBeDefined();
      expect(handle).toBeDefined();
      expect(post?.content).toContain(`@${handle ?? ""}`);
    }
  });

  test("a tag in the body has a PostToTag row", () => {
    const built = plan();
    const nameOf = new Map(
      built.tags.map((tag) => [tag.id, tag.name] as const)
    );
    const postById = new Map(
      [...built.posts, ...built.responses].map((post) => [post.id, post])
    );
    for (const link of built.postTags) {
      const post = postById.get(link.postId);
      const name = nameOf.get(link.tagId);
      expect(post).toBeDefined();
      expect(post?.content).toContain(`#${name ?? ""}`);
    }
  });

  test("mentions and tag links stay within their configured caps", () => {
    const built = plan();
    expect(built.mentions.length).toBeLessThanOrEqual(TINY.mentions);
    expect(built.postTags.length).toBeLessThanOrEqual(TINY.postTags);
  });
});

describe("buildSeedPlan scale", () => {
  test("honours an empty configuration without throwing", () => {
    const empty = buildSeedPlan(
      {
        bookmarks: 0,
        commentReplies: 0,
        commentVotes: 0,
        comments: 0,
        communities: 0,
        communityMembers: 0,
        communityPostShares: 0,
        communitySubscriptions: 0,
        follows: 0,
        gusts: 0,
        mentions: 0,
        postTags: 0,
        postVisits: 0,
        posts: 0,
        responses: 0,
        tags: 0,
        users: 0,
        votes: 0,
      },
      { now: NOW }
    );
    expect(empty.users).toHaveLength(0);
    expect(empty.posts).toHaveLength(0);
    expect(countPlanRows(empty)).toBe(0);
  });

  test("a single user can post but can never interact", () => {
    // One account is a perfectly valid author; what it cannot do is vote,
    // bookmark or follow, because every one of those is a (user, other) pair.
    const solo = buildSeedPlan({ ...TINY, users: 1 }, { now: NOW });
    expect(solo.users).toHaveLength(1);
    expect(solo.posts.length).toBeGreaterThan(0);
    expect(solo.follows).toHaveLength(0);
    expect(solo.votes).toHaveLength(0);
    expect(solo.bookmarks).toHaveLength(0);
    expect(solo.postVisits).toHaveLength(0);
  });

  test("the default config is a corpus worth seeding", () => {
    const built = buildSeedPlan(undefined, { now: NOW });
    expect(built.users.length).toBe(DEFAULT_SEED_CONFIG.users);
    expect(built.posts.length).toBe(
      DEFAULT_SEED_CONFIG.posts + DEFAULT_SEED_CONFIG.communityPostShares
    );
    // Content rows plus the ledger they imply clears ten thousand.
    expect(countPlanRows(built)).toBeGreaterThan(10_000);
  });
});
