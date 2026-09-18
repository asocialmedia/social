import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";

import MediaPage from "@/app/(main)/posts/[postId]/media/[index]/media-page";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";
import {
  absoluteUrl,
  buildPostMediaRequestPath,
  getMediaImage,
  getPostMediaPath,
  getPostMediaUrl,
  getPostPath,
  postDescription,
  postTitle,
  siteConfig,
} from "@/lib/seo/seo";

import { getPost } from "./post-route";

// The index segment must be a strictly decimal non-negative integer, so
// suffixes like "3abc" are rejected instead of silently parsing to 3.
const INDEX_SEGMENT_PATTERN = /^\d+$/;

export interface PostMediaRouteParams {
  communitySlug?: string;
  index: string;
  postId: string;
}
export interface ResolvedPostMediaRoute {
  params: PostMediaRouteParams;
  searchParams: { mediaId?: string };
}

// Preserves the only query param the media route understands across the
// canonical redirect, so a profile-gallery deep link (?mediaId=) still resolves
// after the post moves to its community namespace.
function withMediaId(path: string, mediaId?: string): string {
  return mediaId ? `${path}?mediaId=${encodeURIComponent(mediaId)}` : path;
}

// Resolves the post and enforces the canonical media address, mirroring the
// detail route: a community post's media lives under
// /a/<community>/posts/<id>/media/<index>, everything else under
// /posts/<id>/media/<index>. Non-canonical requests redirect to the canonical.
async function resolveCanonicalMedia(
  params: PostMediaRouteParams,
  mediaId?: string
) {
  if (!INDEX_SEGMENT_PATTERN.test(params.index)) {
    notFound();
  }
  const parsedIndex = Math.trunc(Number(params.index));
  const session = await getSessionFromApi();
  const post = await getPost(params.postId, session?.user?.id ?? "");

  const canonicalPath = getPostMediaPath(post, parsedIndex);
  if (
    buildPostMediaRequestPath({
      communitySlug: params.communitySlug,
      index: params.index,
      postId: params.postId,
    }) !== canonicalPath
  ) {
    permanentRedirect(withMediaId(canonicalPath, mediaId));
  }

  if (parsedIndex >= post.attachments.length) {
    notFound();
  }

  let resolvedIndex = parsedIndex;
  if (mediaId) {
    // When navigating from the profile gallery the URL index is computed from
    // the gallery's newest-first list, which can differ from post.attachments
    // order. Resolve the true index from the media ID instead.
    const mediaIndex = post.attachments.findIndex((m) => m.id === mediaId);
    if (mediaIndex === -1) {
      notFound();
    }
    resolvedIndex = mediaIndex;
  }

  const targetMedia = post.attachments[resolvedIndex];
  if (targetMedia?.type === "AUDIO") {
    redirect(getPostPath(post));
  }

  return { post, resolvedIndex, session };
}

export async function generatePostMediaMetadata({
  params,
  searchParams,
}: ResolvedPostMediaRoute): Promise<Metadata> {
  const { communitySlug, postId, index } = params;
  if (!INDEX_SEGMENT_PATTERN.test(index)) {
    return {};
  }
  const parsedIndex = Math.trunc(Number(index));

  const session = await getSessionFromApi();
  const post = await getPost(postId, session?.user?.id ?? "");
  const canonicalPath = getPostMediaPath(post, parsedIndex);
  // Enforce the canonical namespace in metadata too, so a crawler that lands on
  // the global path for a community post follows the redirect rather than
  // indexing a duplicate.
  if (
    buildPostMediaRequestPath({ communitySlug, index, postId }) !==
    canonicalPath
  ) {
    permanentRedirect(withMediaId(canonicalPath, searchParams.mediaId));
  }
  if (parsedIndex >= post.attachments.length) {
    return {};
  }

  let resolvedIndex = parsedIndex;
  if (searchParams.mediaId) {
    const mediaIndex = post.attachments.findIndex(
      (m) => m.id === searchParams.mediaId
    );
    if (mediaIndex === -1) {
      return {};
    }
    resolvedIndex = mediaIndex;
  }

  const title = postTitle(post);
  const description = postDescription(post);
  // Both preview values follow the RESOLVED attachment (the `?mediaId=` deep
  // link can point at a different index than the URL segment), so the OG url and
  // the OG image never describe two different media.
  const mediaUrl = getPostMediaUrl(post, resolvedIndex);
  const mediaImage = getMediaImage(post, resolvedIndex);

  const ogImageUrl =
    mediaImage || absoluteUrl(`/posts/${post.id}/opengraph-image`);

  return {
    alternates: { canonical: canonicalPath },
    description,
    openGraph: {
      description,
      images: [
        {
          alt: title,
          height: 630,
          url: ogImageUrl,
          width: 1200,
        },
      ],
      siteName: siteConfig.name,
      title,
      type: "article",
      url: mediaUrl,
    },
    title,
    twitter: {
      card: "summary_large_image",
      creator: post.user.username ? `@${post.user.username}` : undefined,
      description,
      images: [ogImageUrl],
      title,
    },
  };
}

// Shareable media route: renders the post page with the media viewer open at
// the given attachment index, so the exact state can be shared by URL. Guests
// can view it read-only.
export async function PostMediaRoute({
  params,
  searchParams,
}: ResolvedPostMediaRoute) {
  const { post, resolvedIndex, session } = await resolveCanonicalMedia(
    params,
    searchParams.mediaId
  );

  const userData = session?.user ? await getUserData(session.user.id) : null;

  if (session?.user && !userData) {
    // The session is valid but the user record is missing (e.g. deleted or
    // suspended account) - surface a not-found instead of bouncing a logged-in
    // session back to the login page.
    notFound();
  }

  return <MediaPage initialMediaIndex={resolvedIndex} post={post} />;
}
