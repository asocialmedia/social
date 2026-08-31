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
  getPostPath,
  getPostUrl,
  postDescription,
  postTitle,
} from "@/lib/seo";
import { getRecentPostsForCrawl } from "@/lib/server-feed";
import { getSessionFromApi } from "@/lib/session";

import ClientPost from "./client-post";

export interface PageProps {
  params: Promise<{ postId: string; slug?: string }>;
}

const getPost = cache(async (postId: string, loggedInUser: string) => {
  let post = await prisma.post.findUnique({
    include: getPostDataInclude(loggedInUser),
    where: {
      id: postId,
    },
  });

  if (!post && postId.length >= 8) {
    const matches = await prisma.post.findMany({
      include: getPostDataInclude(loggedInUser),
      take: 2,
      where: {
        id: { startsWith: postId },
      },
    });
    if (matches.length === 1) {
      post = matches[0] ?? null;
    }
  }

  if (!post) {
    notFound();
  }

  return post;
});

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const { postId } = params;
  const session = await getSessionFromApi();

  let post: Awaited<ReturnType<typeof getPost>> | null = null;
  try {
    post = await getPost(postId, session?.user?.id ?? "");
  } catch {
    // getPost throws notFound() when the row is missing. Under Cache
    // Components the HTTP status stays 200 (the shell is streamed), so we
    // must emit an explicit noindex and a safe title here rather than let
    // the route appear as a soft-404.
    return {
      robots: { follow: false, index: false },
      title: "Post not found",
    };
  }

  if (!post) {
    return {
      robots: { follow: false, index: false },
      title: "Post not found",
    };
  }

  const title = postTitle(post);
  const description = postDescription(post);
  const canonicalPath = getPostPath(post);
  const url = absoluteUrl(canonicalPath);
  const ogImageUrl = absoluteUrl(`/posts/${post.id}/opengraph-image`);
  const postImage = getPostImage(post);

  return {
    alternates: { canonical: canonicalPath },
    category: post.tags[0]?.name,
    description,
    keywords: post.tags.map((tag) => tag.name),
    openGraph: {
      authors: post.user?.username
        ? [absoluteUrl(`/users/${post.user.username}`)]
        : [],
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
      creator: post.user?.username ? `@${post.user.username}` : undefined,
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

  const authorUsername = post.user?.username || "unknown";
  const authorDisplayName =
    post.user?.displayName || post.user?.username || "Anonymous";
  const url = getPostUrl(post);
  const authorUrl = absoluteUrl(`/users/${authorUsername}`);

  const ogImageUrl = absoluteUrl(`/posts/${post.id}/opengraph-image`);

  const postJsonLd = {
    "@context": "https://schema.org",
    "@type": "SocialMediaPosting",
    author: {
      "@type": "Person",
      name: authorDisplayName,
      url: authorUrl,
      ...(post.user?.username
        ? { alternateName: `@${post.user.username}` }
        : {}),
    },
    commentCount: post._count.comments,
    datePublished: post.createdAt.toISOString(),
    description: postDescription(post),
    headline: postTitle(post, 110),
    image: ogImageUrl,
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/CommentAction",
        userInteractionCount: post._count.comments,
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/LikeAction",
        userInteractionCount: post.aura,
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/ViewAction",
        userInteractionCount: post.viewCount,
      },
    ],
    mainEntityOfPage: {
      "@id": url,
      "@type": "WebPage",
    },
    publisher: {
      "@type": "Organization",
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/icons/icon-512x512.png"),
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
        name: `@${authorUsername}`,
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

  // Crawlable related links for bots: the client "View more content" is JS-only.
  const relatedForCrawl = await getRecentPostsForCrawl(10);
  const filteredRelated = relatedForCrawl
    .filter((p) => p.id !== post.id)
    .slice(0, 8);

  const relatedItemList =
    filteredRelated.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: filteredRelated.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: getPostUrl(p),
          })),
          name: "More eddies",
        }
      : null;

  return (
    <>
      <JsonLd
        data={
          relatedItemList
            ? [postJsonLd, breadcrumbJsonLd, relatedItemList]
            : [postJsonLd, breadcrumbJsonLd]
        }
      />
      <ClientPost post={post} userData={userData} />
      {/* Hidden related links for bots - no visible block */}
      {filteredRelated.length > 0 ? (
        <div className="sr-only" aria-hidden={false}>
          <nav aria-label="More eddies crawlable">
            <ul>
              {filteredRelated.map((p) => (
                <li key={p.id}>
                  <a href={getPostPath(p)} tabIndex={-1}>
                    {p.content || p.id}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}
      {/* Tag-based internal links for fresh tags on this post */}
      {post.tags.length > 0 ? (
        <nav
          aria-label="Related tags"
          className="mx-auto w-full max-w-5xl px-4 py-3"
        >
          <p className="text-muted-foreground text-xs">Related tags: </p>
          <ul className="flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <li key={tag.name}>
                <a
                  className="text-primary text-xs hover:underline"
                  href={`/hashtag/${encodeURIComponent(tag.name)}`}
                >
                  #{tag.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </>
  );
}
