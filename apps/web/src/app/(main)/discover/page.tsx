import type { Metadata } from "next";
import { Suspense } from "react";

import ExploreClient from "@/components/discover/explore-client";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import ExplorePageSkeleton from "@/components/layouts/skeletons/explore-page-skeleton";
import PostHistoryCard from "@/components/posts/post-history-card";
import { getSessionFromApi } from "@/lib/session";

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
  const session = await getSessionFromApi();
  const isLoggedIn = Boolean(session?.user);

  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Suspense fallback={<ExplorePageSkeleton />}>
          <ExploreClient />
        </Suspense>
      </div>

      <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
        <div className="flex flex-col gap-4">
          {isLoggedIn ? <PostHistoryCard /> : null}
          <TrendingTopics />
        </div>
      </aside>

      <MobileBottomNav />
    </>
  );
}
