import type { Metadata } from "next";
import DiscoverySidebar from "@/components/discover/discover-sidebar";
import SuggestedUsers from "@/components/discover/suggested-users";
import TrendingUsers from "@/components/discover/trending-users";
import Friends from "@/components/home/sidebars/left/friends";
import NavigationCard from "@/components/home/sidebars/left/navigation-card";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

export const metadata: Metadata = {
  title: "Discover",
  description: "Discover and connect with amazing people on Asocialmedia",
};

export default async function DiscoveryPage() {
  const session = await getSessionFromApi();
  const userData = session?.user ? await getUserData(session.user.id) : null;

  return (
    <main className="flex w-full min-w-0 gap-5">
      <aside className="sticky top-[5rem] mt-5 ml-1 hidden h-[calc(100vh-5.25rem)] w-72 shrink-0 md:block">
        <div className="flex h-full flex-col">
          <DiscoverySidebar />
          <div className="mt-2 flex-none">
            <NavigationCard isCollapsed={false} />
          </div>
          <div className="mt-2 flex-none">
            <Friends isCollapsed={false} />
          </div>
        </div>
      </aside>

      <div className="mt-5 mr-4 mb-14 ml-4 w-full min-w-0 space-y-5 md:mr-0 md:mb-0 md:ml-0">
        <TrendingUsers />
        <SuggestedUsers userId={userData?.id} />
      </div>
    </main>
  );
}
