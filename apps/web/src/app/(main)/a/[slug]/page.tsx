import {
  canViewCommunity,
  getCachedCommunityStats,
  getCommunityBySlug,
  getMembership,
} from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

import CommunityPage from "@/components/communities/page/community-page";
import CommunityPageSkeleton from "@/components/layouts/skeletons/community-page-skeleton";
import JsonLd from "@/components/seo/json-ld";
import { getSessionFromApi } from "@/lib/auth/session";
import { getCommunityPostsForCrawl } from "@/lib/posts/server-feed";
import { absoluteUrl, excerpt, getPostPath } from "@/lib/seo/seo";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const getCommunity = cache(async (slug: string) => {
  const community = await getCommunityBySlug(slug);
  if (!community) {
    notFound();
  }
  return community;
});

// Metadata never varies by viewer; the public community select is enough.
async function getMetadataCommunity(slug: string) {
  "use cache";
  cacheLife("hours");
  return await getCommunityBySlug(slug);
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const community = await getMetadataCommunity(slug);

  if (!community) {
    notFound();
  }

  // A PRIVATE community's name, description and avatar are members-only, but
  // metadata is shared by every viewer and crawler. Emit nothing identifying
  // and mark the page noindex; the page body enforces membership access.
  if (community.type === "PRIVATE") {
    return {
      description: "A private community on Asocial.",
      robots: { follow: false, index: false },
      title: "Private community",
    };
  }

  const title = `a/${community.slug} · ${community.name}`;
  const description = excerpt(community.description, 160);
  const url = absoluteUrl(`/a/${community.slug}`);
  // Prefer the community's own mark for the card; fall back to the banner so a
  // community with only one upload still previews an image.
  let image: string | null = null;
  if (community.avatarUrl) {
    image = absoluteUrl(`/api/communities/avatar/${community.id}/image`);
  } else if (community.bannerUrl) {
    image = absoluteUrl(`/api/communities/banner/${community.id}/image`);
  }

  return {
    alternates: { canonical: `/a/${community.slug}` },
    description,
    keywords: community.topics,
    openGraph: {
      description,
      images: image ? [{ alt: title, url: image }] : [],
      locale: siteConfig.locale,
      siteName: siteConfig.name,
      title,
      type: "website",
      url,
    },
    // Public communities are indexable; the private branch above noindexes.
    robots: { follow: true, index: true },
    title,
    twitter: {
      // `summary` holds for both the square avatar and an arbitrary banner; a
      // large card would letterbox a non-1200x630 upload.
      card: "summary",
      description,
      images: image ? [image] : [],
      title,
    },
  };
}

export default function Page(props: PageProps) {
  // The fallback mirrors the real page so the community's server reads stream
  // into a fully-formed shell instead of a blank frame. This also keeps the
  // route's own loading.tsx boundary consistent with streamed navigation.
  return (
    <Suspense fallback={<CommunityPageSkeleton />}>
      <CommunityContent params={props.params} />
    </Suspense>
  );
}

async function CommunityContent({ params }: PageProps) {
  const { slug } = await params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const community = await getCommunity(slug);
  // A PRIVATE community is invisible to anyone without an ACTIVE membership;
  // 404 rather than a "join to view" screen so the slug cannot be confirmed.
  if (!(await canViewCommunity(community, userId))) {
    notFound();
  }
  // The owner is no longer fetched here: the sidebar's roster lists the founder
  // (with the owner badge) straight from the members API, so this second read
  // was the same person fetched twice.
  const [stats, membership] = await Promise.all([
    getCachedCommunityStats(community.id),
    userId ? getMembership(community.id, userId) : Promise.resolve(null),
  ]);

  const communityUrl = absoluteUrl(`/a/${community.slug}`);
  const avatar = community.avatarUrl
    ? absoluteUrl(`/api/communities/avatar/${community.id}/image`)
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    dateCreated: community.createdAt.toISOString(),
    description: community.description,
    image: avatar ?? undefined,
    inLanguage: "en",
    isPartOf: {
      "@type": "WebSite",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    // Topics double as the page's subject matter for richer entity extraction.
    keywords: community.topics.join(", ") || undefined,
    name: community.name,
    // Posts published into the community, so the page's content is countable.
    numberOfItems: community._count.posts,
    url: communityUrl,
  };

  // Home > Communities > a/<slug>, mirroring the app's own navigation depth.
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
        item: absoluteUrl("/communities"),
        name: "Communities",
        position: 2,
      },
      {
        "@type": "ListItem",
        item: communityUrl,
        name: community.name,
        position: 3,
      },
    ],
  };

  // The community's own posts, rendered server-side as real anchors so the
  // nested /a/<slug>/posts/... URLs are crawlable without executing the client
  // feed. Visually hidden - the interactive feed below owns the on-screen list.
  const crawlPosts = await getCommunityPostsForCrawl(
    { id: community.id, slug: community.slug },
    20
  );

  return (
    <>
      <JsonLd data={[jsonLd, breadcrumbJsonLd]} />
      <CommunityPage
        community={community}
        membership={membership}
        slug={community.slug}
        stats={stats}
      />
      {crawlPosts.length > 0 ? (
        <nav aria-label={`Posts in a/${community.slug}`} className="sr-only">
          <ul>
            {crawlPosts.map((post) => (
              <li key={post.id}>
                <a href={getPostPath(post)} tabIndex={-1}>
                  {post.content || post.id}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </>
  );
}
