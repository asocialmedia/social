import type { Metadata } from "next";
import { Suspense } from "react";
import ExploreClient from "@/components/discover/explore-client";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import PostHistoryCard from "@/components/posts/post-history-card";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

export const metadata: Metadata = {
  title: "Explore",
  description: "Discover and connect with amazing people on Asocialmedia",
};

export default async function DiscoveryPage() {
  const session = await getSessionFromApi();

  if (!session?.user) {
    return (
      <p className="text-destructive">
        You&apos;re not authorized to view this page.
      </p>
    );
  }

  const userData = await getUserData(session.user.id);

  if (!userData) {
    return <p className="text-destructive">Unable to load user data.</p>;
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Suspense fallback={<CenteredLogoLoader size={64} />}>
          <ExploreClient />
        </Suspense>
      </div>

      <aside className="hide-native-scrollbar sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-border/60 border-l px-5 pt-2.5 pb-6 xl:flex">
        <div className="flex flex-col gap-4">
          <PostHistoryCard />
          <TrendingTopics />
        </div>
      </aside>

      <MobileBottomNav />
    </div>
  );
}
