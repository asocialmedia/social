import { normalizeHashtag } from "@asm/protocols/discovery";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import HashtagFeedPage from "@/components/posts/views/hashtag-feed-page";
import JsonLd from "@/components/seo/json-ld";
import { getSessionFromApi } from "@/lib/auth/session";
import { getFirstPublicHashtagPage } from "@/lib/posts/hashtag-posts";
import { absoluteUrl, getPostUrl } from "@/lib/seo/seo";

interface PageProps {
  params: Promise<{ tag: string }>;
}

async function getMetadataTag(rawTag: string) {
  "use cache";
  cacheLife("minutes");
  const name = normalizeHashtag(rawTag);
  if (!name) {
    return null;
  }
  const page = await getFirstPublicHashtagPage(name);
  return { hasMore: Boolean(page.nextCursor), name, posts: page.posts };
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const rawTag = params.tag;

  // Use one normalized hashtag address so mixed-case URLs do not
  // split discovery or search-engine canonical signals.
  const tag = await getMetadataTag(rawTag);
  if (!tag) {
    notFound();
  }

  // Mixed-case casing permanently redirects to canonical casing
  if (params.tag !== encodeURIComponent(tag.name) && rawTag !== tag.name) {
    permanentRedirect(`/hashtag/${encodeURIComponent(tag.name)}`);
  }

  const title = `#${tag.name} on ${siteConfig.name}`;
  // Fleets, not "eddies": an eddie is a comment, a fleet is a post. The old
  // wording leaked a term that means the opposite of what it described, and
  // "post" was the only search-relevant noun in the sentence.
  const description = `Browse #${tag.name} posts from Bluesky and public asocialmedia conversations and communities, newest first.`;
  const url = absoluteUrl(`/hashtag/${encodeURIComponent(tag.name)}`);

  return {
    alternates: { canonical: `/hashtag/${encodeURIComponent(tag.name)}` },
    description,
    keywords: [
      `#${tag.name}`,
      `${tag.name} posts`,
      `${tag.name} social media`,
      `${tag.name} community`,
      `what is ${tag.name}`,
    ],
    openGraph: {
      description,
      images: [
        {
          alt: title,
          height: 630,
          url: siteConfig.ogImage,
          width: 1200,
        },
      ],
      locale: siteConfig.locale,
      siteName: siteConfig.name,
      title,
      type: "website",
      url,
    },
    robots: { follow: true, index: tag.posts.length > 0 || tag.hasMore },
    title,
    twitter: {
      card: "summary_large_image",
      description,
      title,
    },
  };
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<FeedViewSkeleton />}>
      <HashtagContent params={props.params} />
    </Suspense>
  );
}

async function HashtagContent({ params }: PageProps) {
  // Request-bound before the first read: Prisma 8 stamps every query with a
  // crypto.randomUUID() plan id, and Cache Components rejects an uncached value
  // in the prerendered shell, so an unclaimed read aborts the prerender. The
  // Suspense boundary above keeps the shell itself prerenderable.
  await connection();

  const { tag } = await params;
  const decodedTag = normalizeHashtag(tag);
  if (!decodedTag) {
    notFound();
  }

  const canonicalName = decodedTag;
  const tagUrl = absoluteUrl(`/hashtag/${encodeURIComponent(canonicalName)}`);

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    about: `#${canonicalName}`,
    inLanguage: "en",
    isPartOf: {
      "@type": "WebSite",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    name: `#${canonicalName} posts`,
    url: tagUrl,
  };

  // Crawlable links for this tag - visible in SSR so bots discover post URLs
  // without JS, even though the interactive feed is client-fetched.
  const session = await getSessionFromApi();
  const crawlPage = session?.user
    ? undefined
    : await getFirstPublicHashtagPage(canonicalName);
  const crawlPosts = crawlPage?.posts ?? [];

  const itemListJsonLd =
    crawlPosts.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: crawlPosts.map((post, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: getPostUrl(post),
          })),
          name: `#${canonicalName} posts`,
        }
      : null;

  return (
    <>
      <HashtagFeedPage tag={canonicalName} initialGuestPage={crawlPage} />
      <JsonLd
        data={[collectionJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : [])]}
      />
    </>
  );
}
