import type { Metadata } from "next";
import { Suspense } from "react";

import ExploreClient from "@/components/discover/explore-client";
import ExplorePageSkeleton from "@/components/layouts/skeletons/explore-page-skeleton";

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

function DiscoveryContent() {
  return <ExploreClient />;
}
