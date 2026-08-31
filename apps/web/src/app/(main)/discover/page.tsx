import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { Suspense } from "react";

import ExploreClient from "@/components/discover/explore-client";
import ExplorePageSkeleton from "@/components/layouts/skeletons/explore-page-skeleton";
import JsonLd from "@/components/seo/json-ld";
import {
  getRecentGustsForCrawl,
  getRecentPostsForCrawl,
  getTrendingPostsForCrawl,
} from "@/lib/server-feed";

export const metadata: Metadata = {
  description: "Discover and connect with amazing people on asocialmedia",
  title: "Explore",
};

export default function DiscoveryPage() {
  return (
    <Suspense fallback={<ExplorePageSkeleton />}>
      <DiscoveryContent />
    </Suspense>
  );
}

async function DiscoveryContent() {
  const [recentPosts, trendingPosts, gusts] = await Promise.all([
    getRecentPostsForCrawl(20),
    getTrendingPostsForCrawl(12),
    getRecentGustsForCrawl(8),
  ]);

  const itemListJsonLd =
    trendingPosts.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: trendingPosts.slice(0, 10).map((post, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: `${siteConfig.url}/posts/${post.id}`,
          })),
          name: "Trending on asocialmedia",
          numberOfItems: trendingPosts.length,
        }
      : null;

  return (
    <>
      {itemListJsonLd ? <JsonLd data={itemListJsonLd} /> : null}
      <ExploreClient />
      {/* Hidden crawlable links for bots - no visible block (see homepage fix) */}
      <div className="sr-only" aria-hidden={false}>
        <nav aria-label="Trending crawlable">
          <ul>
            {trendingPosts.map((p) => (
              <li key={p.id}>
                <a href={`/posts/${p.id}`}>{p.content || p.id}</a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Latest eddies crawlable">
          <ul>
            {recentPosts.map((p) => (
              <li key={p.id}>
                <a href={`/posts/${p.id}`}>{p.content || p.id}</a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Latest gusts crawlable">
          <ul>
            {gusts.map((p) => (
              <li key={p.id}>
                <a href={`/gusts?id=${p.id}`}>{p.content || p.id}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
