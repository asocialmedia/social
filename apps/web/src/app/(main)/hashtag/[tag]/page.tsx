import { prisma } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import { Hash } from "lucide-react";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import SecondaryRightSideBar from "@/components/layouts/shell/secondary-right-side-bar";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import HashtagFeed from "@/components/posts/views/hashtag-feed";
import JsonLd from "@/components/seo/json-ld";
import { getHashtagPostsForCrawl } from "@/lib/posts/server-feed";
import { absoluteUrl, getPostPath, getPostUrl } from "@/lib/seo/seo";

interface PageProps {
  params: Promise<{ tag: string }>;
}

function safeDecodeTag(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Metadata never varies by viewer, so the canonical-casing lookup and the post
// count are read through a cached scope. generateMetadata cannot sit behind a
// Suspense boundary, so an unclaimed Prisma read here would run inside the
// prerender and abort it (see the connection() note on HashtagContent).
async function getMetadataTag(rawTag: string) {
  "use cache";
  cacheLife("hours");

  const tagRecord = await prisma.orm.public.Tag.select("name")
    .where((tag) => tag.name.ilike(rawTag))
    .first();
  if (!tagRecord) {
    return null;
  }

  const { count } = await prisma.orm.public.Posts.where((post) =>
    post.postToTags.some((postTag) =>
      postTag.tag.some((tag) => tag.name.eq(tagRecord.name))
    )
  ).aggregate((aggregate) => ({ count: aggregate.count() }));

  return { count, name: tagRecord.name };
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const rawTag = safeDecodeTag(params.tag);

  // Resolve the canonical (database) casing of the tag so mixed-case URLs for
  // the same tag do not split their link equity.
  const tag = await getMetadataTag(rawTag);
  if (!tag) {
    notFound();
  }

  // Mixed-case casing permanently redirects to canonical casing
  if (params.tag !== encodeURIComponent(tag.name) && rawTag !== tag.name) {
    permanentRedirect(`/hashtag/${encodeURIComponent(tag.name)}`);
  }

  const { count } = tag;
  const title = `#${tag.name} posts`;
  const description = `${count.toLocaleString()} post${count === 1 ? "" : "s"} tagged #${tag.name} on asocialmedia. Explore the latest eddies and join the conversation.`;
  const url = absoluteUrl(`/hashtag/${encodeURIComponent(tag.name)}`);

  return {
    alternates: { canonical: `/hashtag/${encodeURIComponent(tag.name)}` },
    description,
    keywords: [tag.name, `${tag.name} posts`, `${tag.name} community`],
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
  const decodedTag = safeDecodeTag(tag);
  if (!decodedTag.trim()) {
    notFound();
  }

  const tagRecord = await prisma.orm.public.Tag.select("name")
    .where((candidate) => candidate.name.ilike(decodedTag))
    .first();
  const canonicalName = tagRecord?.name ?? decodedTag;
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
  const crawlPosts = await getHashtagPostsForCrawl(canonicalName, 20);

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
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto">
          <div className="px-4 py-6">
            <div className="border-border bg-card flex items-center gap-2 rounded-xl border p-4">
              <Hash className="text-primary h-6 w-6 shrink-0" />
              <h1 className="text-xl font-semibold">#{canonicalName}</h1>
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-sm">
                posts
              </span>
            </div>
            <div className="mt-5">
              <HashtagFeed tag={canonicalName} />
            </div>
            {crawlPosts.length > 0 ? (
              <div className="sr-only" aria-hidden={false}>
                <nav aria-label={`Recent #${canonicalName} crawlable`}>
                  <ul>
                    {crawlPosts.map((p) => (
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
          </div>
        </div>
      </div>

      <SecondaryRightSideBar />
      <JsonLd
        data={[collectionJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : [])]}
      />
    </>
  );
}
