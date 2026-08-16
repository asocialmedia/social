import type { Metadata } from "next";
import { Suspense } from "react";

import ExploreClient from "@/components/discover/explore-client";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import AppShellSkeleton from "@/components/layouts/skeletons/app-shell-skeleton";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import PostHistoryCard from "@/components/posts/post-history-card";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

export const metadata: Metadata = {
  description: "Discover and connect with amazing people on asocialmedia",
  title: "Explore",
};

export default function DiscoveryPage() {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <DiscoveryContent />
    </Suspense>
  );
}

async function DiscoveryContent() {
  const session = await getSessionFromApi();
  const isLoggedIn = Boolean(session?.user);
  const userData = session?.user ? await getUserData(session.user.id) : null;

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Suspense fallback={<FeedViewSkeleton />}>
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
    </div>
  );
}
