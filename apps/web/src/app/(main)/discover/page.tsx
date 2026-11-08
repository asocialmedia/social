import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import ExploreClient from "@/components/discover/explore-client";
import ExplorePageSkeleton from "@/components/layouts/skeletons/explore-page-skeleton";
import { getPublicBlueskyDiscovery } from "@/lib/seo/bluesky-discovery";
import { blueskyPostPath } from "@/lib/seo/bluesky-metadata";

export const metadata: Metadata = {
  alternates: { canonical: "/discover" },
  description:
    "Explore asocialmedia. Find people worth following, short-form gusts, trending fleets and tags that match what you actually read, tuned from your own activity.",
  keywords: [
    "explore social media",
    "discover people online",
    "find social media creators",
    "trending posts",
    "social media discovery",
    "asocialmedia explore",
  ],
  openGraph: {
    description:
      "People, gusts, trending fleets and tags, tuned from what you read. Open to guests.",
    siteName: siteConfig.name,
    title: `Explore — ${siteConfig.name}`,
    type: "website",
    url: `${siteConfig.url}/discover`,
  },
  title: "Explore",
};

export default function DiscoveryPage() {
  return (
    <Suspense fallback={<ExplorePageSkeleton />}>
      <ExploreClient />
      <PublicNetworkPosts />
    </Suspense>
  );
}

async function PublicNetworkPosts() {
  // Image builds have no database; defer the cached query until a request arrives.
  await connection();
  const posts = await getPublicBlueskyDiscovery();
  if (!posts.length) {
    return null;
  }
  return (
    <section
      className="mx-auto w-full max-w-5xl border-t px-4 py-6"
      aria-label="Across the open social web"
    >
      <h2 className="mb-4 text-lg font-semibold">Across the open social web</h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {posts.slice(0, 12).map((post) => (
          <li key={post.id}>
            <Link
              className="text-sm underline-offset-4 hover:underline"
              href={blueskyPostPath(post.id)}
            >
              @{post.author.handle}: {post.text || "View post"}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
