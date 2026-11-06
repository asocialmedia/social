import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { Suspense } from "react";

import ExploreClient from "@/components/discover/explore-client";
import ExplorePageSkeleton from "@/components/layouts/skeletons/explore-page-skeleton";

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
  },
  title: "Explore",
};

export default function DiscoveryPage() {
  return (
    <Suspense fallback={<ExplorePageSkeleton />}>
      <ExploreClient />
    </Suspense>
  );
}
