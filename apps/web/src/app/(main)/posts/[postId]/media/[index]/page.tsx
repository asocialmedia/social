import { getPostDataInclude, prisma } from "@asm/db";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { getUserData } from "@/hooks/use-user-data";
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
// can be shared by URL.
export default async function Page(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const { postId, index } = params;
  if (!INDEX_SEGMENT_PATTERN.test(index)) {
    notFound();
  }
  const parsedIndex = Math.trunc(Number(index));

  const session = await getSessionFromApi();

  if (!session?.user) {
    // Preserve the mediaId query param (used to resolve the true attachment
    // index from the profile gallery) across the login round-trip.
    const mediaIdQuery = searchParams.mediaId
      ? `?mediaId=${encodeURIComponent(searchParams.mediaId)}`
      : "";
    const next = `/posts/${encodeURIComponent(postId)}/media/${parsedIndex}${mediaIdQuery}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const [post, userData] = await Promise.all([
    getPost(postId, session.user.id),
    getUserData(session.user.id),
  ]);

  if (!userData) {
    // The session is valid but the user record is missing (e.g. deleted or
    // suspended account) - surface a not-found instead of bouncing a logged-in
    // session back to the login page. Unauthenticated sessions keep the
    // redirect above.
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
