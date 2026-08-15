import { getPostDataInclude, prisma } from "@asm/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getUserData } from "@/hooks/use-user-data";
import {
  absoluteUrl,
  getMediaImage,
  postDescription,
  postTitle,
  siteConfig,
} from "@/lib/seo";
import { getSessionFromApi } from "@/lib/session";

import ClientPost from "../../client-post";

interface PageProps {
  params: Promise<{ postId: string; index: string }>;
  searchParams: Promise<{ mediaId?: string }>;
}

// The index segment must be a strictly decimal non-negative integer, so
// suffixes like "3abc" are rejected instead of silently parsing to 3.
const INDEX_SEGMENT_PATTERN = /^\d+$/;

const getPost = cache(async (postId: string, loggedInUser: string) => {
  const post = await prisma.post.findUnique({
    include: getPostDataInclude(loggedInUser),
    where: {
      id: postId,
    },
  });

  if (!post) {
    notFound();
  }

  return post;
});

// Shareable media route: /posts/{postId}/media/{index} renders the post page
// with the media viewer open at the given attachment index, so the exact state
// can be shared by URL. Guests can view it read-only.
export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const { postId, index } = params;
  if (!INDEX_SEGMENT_PATTERN.test(index)) {
    return {};
  }
  const parsedIndex = Math.trunc(Number(index));

  const session = await getSessionFromApi();
  const post = await getPost(postId, session?.user?.id ?? "");
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
  const mediaUrl = `/posts/${post.id}/media/${parsedIndex}`;
  const mediaImage = getMediaImage(post, resolvedIndex);

  const ogImageUrl =
    mediaImage || absoluteUrl(`/posts/${post.id}/opengraph-image`);

  return {
    alternates: { canonical: mediaUrl },
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
      url: absoluteUrl(mediaUrl),
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

export default async function Page(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const { postId, index } = params;
  if (!INDEX_SEGMENT_PATTERN.test(index)) {
    notFound();
  }
  const parsedIndex = Math.trunc(Number(index));

  const session = await getSessionFromApi();

  const [post, userData] = await Promise.all([
    getPost(postId, session?.user?.id ?? ""),
    session?.user ? getUserData(session.user.id) : Promise.resolve(null),
  ]);

  if (session?.user && !userData) {
    // The session is valid but the user record is missing (e.g. deleted or
    // suspended account) - surface a not-found instead of bouncing a logged-in
    // session back to the login page.
    notFound();
  }

  if (parsedIndex >= post.attachments.length) {
    notFound();
  }

  let resolvedIndex = parsedIndex;
  if (searchParams.mediaId) {
    // When navigating from the profile gallery the URL index is computed from
    // the gallery's newest-first list, which can differ from post.attachments
    // order. Resolve the true index from the media ID instead.
    const mediaIndex = post.attachments.findIndex(
      (m) => m.id === searchParams.mediaId
    );
    if (mediaIndex === -1) {
      notFound();
    }
    resolvedIndex = mediaIndex;
  }

  return (
    <ClientPost
      initialMediaIndex={resolvedIndex}
      post={post}
      userData={userData}
    />
  );
}
