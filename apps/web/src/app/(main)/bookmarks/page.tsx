import { prisma } from "@asm/db";
import type { Metadata } from "next";
import NavigationCard from "@/components/home/sidebars/left/navigation-card";
import ProfileCard from "@/components/home/sidebars/right/profile-card";
import SuggestedConnections from "@/components/home/sidebars/right/suggested-connections";
import TrendingTopics from "@/components/home/sidebars/right/trending-topics";
import StickyFooter from "@/components/layouts/stinky-footer";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";
import Bookmarks from "./bookmarks";

export const metadata: Metadata = {
  title: "Bookmarks",
};

export default async function Page() {
  const session = await getSessionFromApi();
  const userData = session?.user ? await getUserData(session.user.id) : null;

  let bookmarkCount = 0;
  let hnBookmarkCount = 0;

  if (session?.user) {
    const [postBookmarks, hnBookmarks] = await Promise.all([
      prisma.bookmark.count({
        where: { userId: session.user.id },
      }),
      prisma.hNBookmark.count({
        where: { userId: session.user.id },
      }),
    ]);

    bookmarkCount = postBookmarks;
    hnBookmarkCount = hnBookmarks;
  }

  return (
    <main className="flex w-full min-w-0 gap-5">
      <aside className="sticky top-[5rem] ml-1 hidden h-[calc(100vh-5.25rem)] w-72 shrink-0 md:block">
        <div className="flex h-full flex-col">
          <NavigationCard
            className="flex-none"
            isCollapsed={false}
            stickyTop="5rem"
          />
          <div className="mt-2 flex-none">
            <SuggestedConnections />
          </div>
          {userData ? (
            <div className="mt-auto mb-4">
              <ProfileCard userData={userData} />
            </div>
          ) : null}
        </div>
      </aside>

      <div className="mt-5 w-full min-w-0 space-y-5">
        <Bookmarks />
      </div>

      <div className="sticky top-[5.25rem] hidden h-fit w-80 flex-none lg:block">
        <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-xs">
          <h2 className="font-bold text-xl">Bookmarks Info</h2>
          <p className="text-muted-foreground">
            Here you can view and manage your bookmarked content.
          </p>
          <div className="space-y-2">
            <p className="text-muted-foreground">
              Posts bookmarks: {bookmarkCount}
            </p>
            <p className="text-muted-foreground">
              HackerNews bookmarks: {hnBookmarkCount}
            </p>
            <p className="text-muted-foreground">
              Total bookmarks: {bookmarkCount + hnBookmarkCount}
            </p>
          </div>
        </div>
        <div className="mt-2 mb-2">
          <TrendingTopics />
        </div>

        <div className="mt-4">
          <StickyFooter />
        </div>
      </div>
    </main>
  );
}
