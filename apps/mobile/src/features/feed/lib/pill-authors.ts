// Authors for the new-content pill: one entry per distinct author id,
// first-seen order, so the avatar stack mirrors the feed. Shared by the
// home feed list and the explore stream (both render NewContentPill).
import type { PillAuthor } from "../components/new-content-pill";
import type { FeedPost } from "./feed-types";

export function pillAuthors(posts: readonly FeedPost[]): PillAuthor[] {
  return [
    ...new Map(
      posts.map((post) => [
        post.userId,
        {
          avatarUrl: post.user?.avatarUrl ?? null,
          id: post.userId,
          username: post.user?.username ?? null,
        },
      ])
    ).values(),
  ];
}
