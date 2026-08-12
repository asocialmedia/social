"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback } from "react";
import FollowingFeed from "@/components/home/feedview/following";
import ForYouFeed from "@/components/home/for-you-feed";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import RightSideBar from "@/components/home/sidebars/right-side-bar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import PostEditor from "@/components/posts/editor/post-editor";

interface ClientHomeProps {
  userData: UserData;
}

type FeedTab = "for-you" | "global" | "following";

const TAB_TRIGGER_CLASS =
  "relative inline-flex h-full items-center justify-center rounded-none border-0 px-3 py-3 font-medium text-muted-foreground text-sm outline-none transition-all duration-200 ease-out after:absolute after:bottom-0 after:left-1/2 after:h-1 after:w-6 after:-translate-x-1/2 after:bg-gradient-to-b after:from-[#ff9500] after:to-[#e65500] after:opacity-0 after:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1px_1.5px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.12)] after:transition-opacity after:content-[''] hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] data-[state=active]:px-8 data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:opacity-100 data-[state=active]:hover:bg-none data-[state=active]:hover:from-none data-[state=active]:hover:to-none data-[state=active]:hover:shadow-none data-[state=active]:hover:text-foreground";

const ClientHome: React.FC<ClientHomeProps> = ({ userData }) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  let tab: FeedTab = "for-you";
  if (tabParam === "following") {
    tab = "following";
  } else if (tabParam === "global") {
    tab = "global";
  }

  const handleTabChange = useCallback(
    (value: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (value === "following" || value === "global") {
        nextParams.set("tab", value);
      } else {
        nextParams.delete("tab");
      }
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );

  if (!userData) {
    return null;
  }

  return (
    <div className="relative flex min-h-screen overflow-x-clip">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs onValueChange={handleTabChange} value={tab}>
          <div className="sticky top-0 z-20 bg-[hsl(var(--background-alt))]/90 pt-5 backdrop-blur-md">
            <MobileTopBar />
            <div className="relative flex items-center border-border/60 border-b">
              <TabsList className="flex h-full flex-1 items-center justify-center gap-0 bg-transparent p-0">
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="for-you">
                  Trending
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="global">
                  Global
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="following">
                  Following
                </TabsTrigger>
              </TabsList>
              <button
                aria-label="Create new list"
                className="absolute top-0 right-0 flex h-full w-12 shrink-0 cursor-default items-center justify-center border-border/60 border-l text-muted-foreground"
                type="button"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>

          <PostEditor />

          <TabsContent className="mt-0 pb-12" value="for-you">
            <ForYouFeed />
          </TabsContent>

          <TabsContent className="mt-0 pb-12" value="global">
            <ForYouFeed />
          </TabsContent>

          <TabsContent className="mt-0 pb-12" value="following">
            <FollowingFeed />
          </TabsContent>
        </Tabs>
      </div>

      <RightSideBar />
      <MobileBottomNav />
    </div>
  );
};

export default ClientHome;
