import { prisma } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import { Hash } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import SecondaryRightSideBar from "@/components/layouts/secondary-right-side-bar";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import HashtagFeed from "@/components/posts/hashtag-feed";
import JsonLd from "@/components/seo/json-ld";
import { absoluteUrl } from "@/lib/seo";
import { getHashtagPostsForCrawl } from "@/lib/server-feed";

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

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const rawTag = safeDecodeTag(params.tag);

  // Resolve the canonical (database) casing of the tag so mixed-case URLs for
  // the same tag do not split their link equity.
  const tagRecord = await prisma.tag.findFirst({
    select: { name: true },
    where: { name: { equals: rawTag, mode: "insensitive" } },
  });
  if (!tagRecord) {
    return {
      robots: { follow: false, index: false },
      title: `#${rawTag} — not found`,
    };
  }

  const count = await prisma.post.count({
    where: { tags: { some: { name: tagRecord.name } } },
  });

  const title = `#${tagRecord.name} posts`;
  const description = `${count.toLocaleString()} post${count === 1 ? "" : "s"} tagged #${tagRecord.name} on asocialmedia. Explore the latest eddies and join the conversation.`;
  const url = absoluteUrl(`/hashtag/${encodeURIComponent(tagRecord.name)}`);

  return {
    alternates: { canonical: `/hashtag/${encodeURIComponent(tagRecord.name)}` },
    description,
    keywords: [
      tagRecord.name,
      `${tagRecord.name} posts`,
      `${tagRecord.name} community`,
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
  const { tag } = await params;
  const decodedTag = safeDecodeTag(tag);
  if (!decodedTag.trim()) {
    notFound();
  }

  const tagRecord = await prisma.tag.findFirst({
    select: { name: true },
    where: { name: { equals: decodedTag, mode: "insensitive" } },
  });
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
            url: `${siteConfig.url}/posts/${post.id}`,
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
                        <a href={`/posts/${p.id}`}>{p.content || p.id}</a>
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
