// The post page header's copy and backdrop, ported from web's
// getHeaderTitles and banner fallback chain in client-post.tsx.
import type { FeedPost } from "@/features/feed/lib/feed-types";

export function postHeaderTitles(post: FeedPost): {
  subtitle: string | null;
  title: string;
} {
  const authorName =
    post.external?.author.displayName ||
    post.user?.displayName ||
    post.external?.author.handle ||
    post.user?.username;

  if (post.community) {
    return {
      subtitle: authorName
        ? `Posted by @${post.user?.username || authorName}`
        : "Community Post",
      title: post.community.name,
    };
  }

  let subtitle: string | null = null;
  if (
    post.user?.username &&
    post.user.displayName &&
    post.user.displayName !== post.user.username
  ) {
    subtitle = `@${post.user.username}`;
  } else if (post.external) {
    const { handle } = post.external.author;
    subtitle = handle ? `@${handle}` : "Bluesky";
  }

  return { subtitle, title: authorName ? `${authorName}'s Post` : "Post" };
}

// Banner first, then the avatar, from the external author before the native one.
export function postHeaderImage(post: FeedPost): string | null {
  return (
    post.external?.author.bannerUrl ||
    post.user?.bannerUrl ||
    post.external?.author.avatarUrl ||
    post.user?.avatarUrl ||
    null
  );
}

interface ExternalHeaderAuthor {
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  displayName?: string | null;
  handle?: string | null;
}

// The DID inside an at:// URI, which is what web's external post page feeds
// useBlueskyProfile before the post itself has loaded.
export function externalUriActor(uri: string): string {
  return uri.startsWith("at://") ? (uri.slice(5).split("/")[0] ?? "") : "";
}

// Web's external post header. With the post loaded it is client-post's
// getHeaderTitles plus banner chain, preferring the fetched Bluesky profile
// over the post's embedded author. Without the post it is
// external-post-page's fallback, which reads the profile alone.
export function externalPostHeader(
  postAuthor: ExternalHeaderAuthor | null,
  profile: ExternalHeaderAuthor | null | undefined
): { bannerUrl: string | null; subtitle: string; title: string } {
  const authorName = postAuthor
    ? profile?.displayName ||
      postAuthor.displayName ||
      profile?.handle ||
      postAuthor.handle
    : profile?.displayName;
  const handle = profile?.handle || postAuthor?.handle;
  return {
    bannerUrl:
      profile?.bannerUrl ||
      postAuthor?.bannerUrl ||
      profile?.avatarUrl ||
      postAuthor?.avatarUrl ||
      null,
    subtitle: handle ? `@${handle}` : "Bluesky",
    title: authorName ? `${authorName}'s Post` : "Post",
  };
}
