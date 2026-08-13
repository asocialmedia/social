import type { Metadata } from "next";
import BrowseUsers from "@/components/discover/browse-users";
import DiscoverySidebar from "@/components/discover/discover-sidebar";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import SecondaryRightSideBar from "@/components/layouts/secondary-right-side-bar";
import { getUserData } from "@/hooks/use-user-data";
import { getSessionFromApi } from "@/lib/session";

export const metadata: Metadata = {
  title: "Browse Users",
  description: "Browse all users on Asocialmedia",
};

export default async function BrowsePage() {
  const session = await getSessionFromApi();
  const userData = session?.user ? await getUserData(session.user.id) : null;

  if (!userData) {
    return null;
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden">
          <div className="px-4 py-6">
            <BrowseUsers userId={userData.id} />
          </div>
        </div>
      </div>

      <SecondaryRightSideBar>
        <DiscoverySidebar />
      </SecondaryRightSideBar>
    </div>
  );
}
