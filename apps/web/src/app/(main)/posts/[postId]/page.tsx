import { getPostDataInclude, prisma } from "@asm/db";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

import ClientPost from "./client-post";

interface PageProps {
  params: Promise<{ postId: string }>;
}

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

export async function generateMetadata(props: PageProps) {
  const params = await props.params;
  const { postId } = params;
  const session = await getSessionFromApi();
  const post = await getPost(postId, session?.user?.id ?? "");
  if (!post) {
    return {};
  }

  return {
    title: `${post.user.displayName}: ${post.content.slice(0, 50)}...`,
  };
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const { postId } = params;
  const session = await getSessionFromApi();

  const [post, userData] = await Promise.all([
    getPost(postId, session?.user?.id ?? ""),
    session?.user ? getUserData(session.user.id) : Promise.resolve(null),
  ]);

  return <ClientPost post={post} userData={userData} />;
}
