import {
  getPostAncestors,
  getPostDataQuery,
  mapPostData,
  prisma,
} from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import ClientPost from "@/app/(main)/posts/[postId]/client-post";
import JsonLd from "@/components/seo/json-ld";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";
import {
  POST_MATCH_CANDIDATE_LIMIT,
  selectPostMatch,
} from "@/lib/posts/post-match";
import type { PostMatchIdentity } from "@/lib/posts/post-match";
import { getRecentPostsForCrawl } from "@/lib/posts/server-feed";
import {
  absoluteUrl,
  buildPostRequestPath,
  getPostImage,
  getPostPath,
  getPostUrl,
  postDescription,
  postTitle,
} from "@/lib/seo/seo";

// Route params resolved from either the global /posts tree or the nested
// /a/<community>/posts tree. Only the community route supplies communitySlug.
export interface PostRouteParams {
  communitySlug?: string;
  postId: string;
  slug?: string;
}

export const getPost = cache(
  async (
    postId: string,
    loggedInUser: string,
    identity: PostMatchIdentity = {}
  ) => {
    const postQuery = getPostDataQuery(prisma.orm, loggedInUser);
    const postRow = await postQuery.where({ id: postId }).first();
    let post = postRow ? mapPostData(postRow) : null;

    if (!post && postId.length >= 8) {
      // The 8-char short id is a cuid timestamp prefix, so two posts created in
      // the same millisecond share it. Fetch the candidates and let the slug
      // (or the requested media row) pick the intended one, instead of 404ing
      // on an ambiguous prefix.
      const matches = await postQuery
        .where((candidate) => candidate.id.ilike(`${postId}%`))
        .limit(POST_MATCH_CANDIDATE_LIMIT)
        .all();
      post = selectPostMatch(matches.map(mapPostData), identity);
    }

    if (!post) {
      notFound();
    }

    return post;
  }
);

// Resolves the post and enforces the single canonical address. A community
// post must live under its community (`/a/<slug>/posts/...`); a global post or
// reshare must live under `/posts/...`. Anything else - the wrong community
// slug, a stale content slug, the global path for a community post, or the
// full id instead of the short one - permanently redirects to the canonical.
async function resolveCanonicalPost(params: PostRouteParams) {
  const session = await getSessionFromApi();
  const post = await getPost(params.postId, session?.user?.id ?? "", {
    slug: params.slug,
  });

  if (post.isGust) {
    permanentRedirect(`/gusts?id=${post.id}`);
  }

  const canonicalPath = getPostPath(post);
  if (buildPostRequestPath(params) !== canonicalPath) {
    permanentRedirect(canonicalPath);
  }

  return { post, session };
}

export async function generatePostMetadata(
  params: PostRouteParams
): Promise<Metadata> {
  const session = await getSessionFromApi();

  // Only the lookup is guarded: `notFound()` / `permanentRedirect()` throw
  // control-flow errors that must propagate, so the canonical check below runs
  // OUTSIDE this try.
  let post: Awaited<ReturnType<typeof getPost>>;
  try {
    post = await getPost(params.postId, session?.user?.id ?? "", {
      slug: params.slug,
    });
  } catch {
    notFound();
  }

  if (post.isGust) {
    permanentRedirect(`/gusts?id=${post.id}`);
  }

  const canonicalPath = getPostPath(post);
  if (buildPostRequestPath(params) !== canonicalPath) {
    permanentRedirect(canonicalPath);
  }
  const title = postTitle(post);
  const description = postDescription(post);
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

// The shared post detail render. Pages wrap this in their own Suspense
// boundary with PostDetailSkeleton, so the fallback is skipped when the post
// was already cached during metadata generation.
export async function PostRoute({ params }: { params: PostRouteParams }) {
  const { post, session } = await resolveCanonicalPost(params);

  const userData = session?.user ? await getUserData(session.user.id) : null;

  const ancestors = post.parentPostId
    ? await getPostAncestors(post.parentPostId, session?.user?.id ?? "")
    : [];

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
      ...(post.community
        ? [
            {
              "@type": "ListItem",
              item: absoluteUrl(`/a/${post.community.slug}`),
              name: `a/${post.community.slug}`,
              position: 2,
            },
          ]
        : [
            {
              "@type": "ListItem",
              item: authorUrl,
              name: `@${authorUsername}`,
              position: 2,
            },
          ]),
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
      <ClientPost ancestors={ancestors} post={post} userData={userData} />
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
      {/* Tag-based internal links for SEO - hidden visually (was visible Related tags block) */}
      {post.tags.length > 0 ? (
        <nav aria-label="Related tags" className="sr-only">
          <p>Related tags: </p>
          <ul>
            {post.tags.map((tag) => (
              <li key={tag.name}>
                <a
                  href={`/hashtag/${encodeURIComponent(tag.name)}`}
                  tabIndex={-1}
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
