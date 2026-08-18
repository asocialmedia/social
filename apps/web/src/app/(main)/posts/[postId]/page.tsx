import { getPostDataInclude, prisma } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

import PostDetailSkeleton from "@/components/layouts/skeletons/post-detail-skeleton";
import JsonLd from "@/components/seo/json-ld";
import { getUserData } from "@/hooks/use-user-data";
import {
  absoluteUrl,
  getPostImage,
  postDescription,
  postTitle,
} from "@/lib/seo";
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

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const { postId } = params;
  const session = await getSessionFromApi();
  const post = await getPost(postId, session?.user?.id ?? "");

  const title = postTitle(post);
  const description = postDescription(post);
  const url = absoluteUrl(`/posts/${post.id}`);
  const ogImageUrl = absoluteUrl(`/posts/${post.id}/opengraph-image`);
  const postImage = getPostImage(post);

  return {
    alternates: { canonical: `/posts/${post.id}` },
    category: post.tags[0]?.name,
    description,
    keywords: post.tags.map((tag) => tag.name),
    openGraph: {
      authors: [absoluteUrl(`/users/${post.user.username}`)],
      description,
      images: [
        {
          alt: title,
          height: 630,
          url: ogImageUrl,
          width: 1200,
        },
        ...(postImage ? [{ alt: title, url: postImage }] : []),
      ],
      locale: siteConfig.locale,
      publishedTime: post.createdAt.toISOString(),
      siteName: siteConfig.name,
      tags: post.tags.map((tag) => tag.name),
      title,
      type: "article",
      url,
    },
    robots: {
      follow: true,
      index: true,
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

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<PostDetailSkeleton />}>
      <PostContent params={props.params} />
    </Suspense>
  );
}

async function PostContent({ params }: PageProps) {
  const { postId } = await params;
  const session = await getSessionFromApi();

  const [post, userData] = await Promise.all([
    getPost(postId, session?.user?.id ?? ""),
    session?.user ? getUserData(session.user.id) : Promise.resolve(null),
  ]);

  const url = absoluteUrl(`/posts/${post.id}`);
  const authorUrl = absoluteUrl(`/users/${post.user.username}`);
  const postImage = getPostImage(post);

  const postJsonLd = {
    "@context": "https://schema.org",
    "@type": "SocialMediaPosting",
    author: {
      "@type": "Person",
      name: post.user.displayName,
      url: authorUrl,
      ...(post.user.username
        ? { alternateName: `@${post.user.username}` }
        : {}),
    },
    commentCount: post._count.comments,
    datePublished: post.createdAt.toISOString(),
    description: postDescription(post),
    headline: postTitle(post, 110),
    image: postImage ?? undefined,
    inLanguage: "en",
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/LikeAction",
        userInteractionCount: post.aura,
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/CommentAction",
        userInteractionCount: post._count.comments,
      },
    ],
    keywords: post.tags.map((tag) => tag.name).join(", "),
    mainEntityOfPage: {
      "@id": url,
      "@type": "WebPage",
    },
    publisher: {
      "@type": "Organization",
      logo: {
        "@type": "ImageObject",
        url: `${siteConfig.url}/favicon/android-chrome-512x512.png`,
      },
      name: siteConfig.name,
      url: siteConfig.url,
    },
    url,
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        item: siteConfig.url,
        name: "Home",
        position: 1,
      },
      {
        "@type": "ListItem",
        item: authorUrl,
        name: `@${post.user.username}`,
        position: 2,
      },
      {
        "@type": "ListItem",
        item: url,
        name: postTitle(post, 40),
        position: 3,
      },
    ],
  };

  return (
    <>
      <JsonLd data={[postJsonLd, breadcrumbJsonLd]} />
      <ClientPost post={post} userData={userData} />
    </>
  );
}
