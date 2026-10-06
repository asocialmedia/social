import type { FeedPost } from "./feed-types";
import {
  isAudioMedia,
  isVideoMedia,
  mediaGridImageUrl,
  mediaImageUrl,
  mediaPosterUrl,
} from "./media-url";

// Match the rendered image URLs, deduplicate shared avatars, and key work by
// media identity so view-count updates do not restart the same prefetch batch.
export function feedPrefetchUrls(posts: FeedPost[], apiBase: string): string[] {
  const urls = new Set<string>();
  for (const post of posts.slice(0, 20)) {
    const avatar = post.user?.avatarUrl;
    if (avatar) {
      urls.add(avatar.startsWith("http") ? avatar : `${apiBase}${avatar}`);
    }
    const attachments = post.attachments ?? [];
    for (const media of attachments) {
      if (!media?.id || isAudioMedia(media)) {
        continue;
      }
      if (isVideoMedia(media)) {
        urls.add(mediaPosterUrl(apiBase, media.id));
      } else {
        urls.add(
          attachments.length === 1
            ? mediaImageUrl(apiBase, media)
            : mediaGridImageUrl(apiBase, media)
        );
      }
      if (urls.size >= 16) {
        return [...urls].slice(0, 16);
      }
    }
    if (urls.size >= 16) {
      break;
    }
  }
  return [...urls].slice(0, 16);
}
