import { followingGustAvatars } from "@asm/ui/lib/gust-header";
import type { GustFollowingAvatar } from "@asm/ui/lib/gust-header";

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { FeedApiError } from "@/features/feed/lib/feed-api";
import type { PostsPage } from "@/features/feed/lib/feed-types";
import { fetchProfileUserList } from "@/features/profile/lib/profile-api";

import { fetchGustsPage } from "./gusts-api";

export interface FollowingGustPreview {
  data: PostsPage | null;
  fallbackAvatars: GustFollowingAvatar[];
}

export async function fetchFollowingGustPreview(
  userId: string,
  options: ApiCallOptions
): Promise<FollowingGustPreview> {
  let data: PostsPage | null = null;
  try {
    data = await fetchGustsPage(
      { following: true, personalized: false, take: 5 },
      options
    );
    if (followingGustAvatars(data.posts).length) {
      return { data, fallbackAvatars: [] };
    }
  } catch (error) {
    if (!(error instanceof FeedApiError) || error.status !== 409) {
      throw error;
    }
  }
  // Followed profiles still identify this feed before a source-aware backend is deployed.
  const people = await fetchProfileUserList(userId, "following", options);
  return {
    data,
    fallbackAvatars: people.slice(0, 3).map(({ avatarUrl, id, username }) => ({
      avatarUrl,
      id,
      username,
    })),
  };
}
