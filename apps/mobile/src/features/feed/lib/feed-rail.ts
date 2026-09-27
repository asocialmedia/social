import { resolveCommunityAccentColor } from "@/features/communities/lib/community-accents";

// Web uses orange-500 (#f97316) as Hacker News's signature color rail.
export const HN_RAIL_COLOR = "#f97316";

export interface PostRailCandidate {
  community?: { accentColor?: string | null } | null;
  communityShare?: {
    community?: { accentColor?: string | null } | null;
  } | null;
  hnStoryShare?: unknown | null;
}

// Computes the left vertical indicator color for post cards.
// Mirrors web's getPostCardBorderAndPadding / rail logic in post-card.tsx:
// HN posts keep the orange signature (#f97316), a community post takes
// the community's accent color. A community rail wins when a post is somehow both.
export function getPostRailColor(
  post: PostRailCandidate,
  isDark: boolean
): string | null {
  const { community } = post;
  if (community) {
    return resolveCommunityAccentColor(community.accentColor, isDark);
  }
  if (post.communityShare?.community) {
    return resolveCommunityAccentColor(
      post.communityShare.community.accentColor,
      isDark
    );
  }
  if (post.hnStoryShare) {
    return HN_RAIL_COLOR;
  }
  return null;
}
