import type {
  FeedMedia,
  FeedPost,
  FeedUser,
} from "@/features/feed/lib/feed-types";

import type { ProfileViewTab } from "./profile-tab-memory";

export interface ProfileHeaderProfile {
  aura: number;
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  bannerUrl: string | null;
  bio: string | null;
  communityMemberships: {
    community?: { slug?: string | null } | null;
    role: string;
  }[];
  createdAt: string;
  customDomain: string | null;
  displayName: string | null;
  followers: { followerId: string }[];
  githubUsername: string | null;
  id: string;
  isFollowing: boolean;
  linkedinUsername: string | null;
  redditUsername: string | null;
  twitterUsername: string | null;
  username: string;
  _count: { followers: number; following: number; posts: number };
}

export interface ProfileMedia extends FeedMedia {
  createdAt: string;
  post: {
    community: { slug: string } | null;
    explicitContent: boolean;
    id: string;
    isGust: boolean;
    moderated: boolean;
  } | null;
}

// Web sizes each media tile by the item's real dimensions so the tab reads as
// a masonry wall rather than a uniform checkerboard, falling back to square
// when an upload never recorded them. A falsy width is caught by the same
// check, because zero would otherwise divide the tile away to nothing.
const DEFAULT_MEDIA_ASPECT = 1;

export function mediaTileAspect(item: ProfileMedia): number {
  return item.width && item.height
    ? item.width / item.height
    : DEFAULT_MEDIA_ASPECT;
}

export interface ProfileReply {
  attachments: FeedMedia[];
  content: string | null;
  createdAt: string;
  id: string;
  parent: { user: { username: string } | null } | null;
  post: FeedPost;
  user?: FeedUser;
  votes: { userId: string; value: number }[];
}

export type ProfileFeedStatus =
  | "error"
  | "idle"
  | "loading"
  | "loading-more"
  | "success";

interface ProfileFeedViewBase {
  error: string | null;
  fetchNext: () => void;
  hasMore: boolean;
  // Re-runs the tab's first page from scratch, used after a mutation that
  // removes a row (a deleted eddie) so the list cannot keep a dead entry.
  reload: () => void;
  posts: FeedPost[];
  status: ProfileFeedStatus;
  tab: ProfileViewTab;
}

export type ProfileFeedView =
  | (ProfileFeedViewBase & {
      kind: "posts";
      media?: never;
      replies?: never;
      tab: "amplified" | "gusts" | "posts" | "responses";
    })
  | (ProfileFeedViewBase & {
      kind: "media";
      media: ProfileMedia[];
      replies?: never;
      tab: "media";
    })
  | (ProfileFeedViewBase & {
      kind: "replies";
      media?: never;
      replies: ProfileReply[];
      tab: "eddies";
    });
