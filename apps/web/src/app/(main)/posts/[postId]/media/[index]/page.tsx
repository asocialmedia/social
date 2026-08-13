import { getPostDataInclude, prisma } from "@asm/db";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";
import MediaPostClient from "./media-post-client";

interface PageProps {
  params: Promise<{ postId: string; index: string }>;
}

const getPost = cache(async (postId: string, loggedInUser: string) => {
  const post = await prisma.post.findUnique({
    where: {
      id: postId,
    },
    include: getPostDataInclude(loggedInUser),
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
  const { postId, index } = params;
  const parsedIndex = Number.parseInt(index, 10);

  if (Number.isNaN(parsedIndex) || parsedIndex < 0) {
    notFound();
  }

  const session = await getSessionFromApi();

  if (!session?.user) {
    redirect(
      `/login?next=/posts/${encodeURIComponent(postId)}/media/${parsedIndex}`
    );
  }

  const [post, userData] = await Promise.all([
    getPost(postId, session.user.id),
    getUserData(session.user.id),
  ]);

  if (!userData) {
    redirect(
      `/login?next=/posts/${encodeURIComponent(postId)}/media/${parsedIndex}`
    );
  }

  if (parsedIndex >= post.attachments.length) {
    notFound();
  }

  return (
    <MediaPostClient
      initialIndex={parsedIndex}
      post={post}
      userData={userData}
    />
  );
}
