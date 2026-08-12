"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
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

type FeedTab = "for-you" | "following";

const TAB_TRIGGER_CLASS =
  "rounded-none border-transparent border-b-2 py-3 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none";

const ClientHome: React.FC<ClientHomeProps> = ({ userData }) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tab: FeedTab =
    searchParams.get("tab") === "following" ? "following" : "for-you";

  const handleTabChange = useCallback(
    (value: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (value === "following") {
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
          <div className="sticky top-0 z-20">
            <MobileTopBar />
            <div className="border-border/60 border-b bg-[hsl(var(--background-alt))]/90 backdrop-blur-md">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-0 bg-transparent p-0">
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="for-you">
                  Global
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="following">
                  Following
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          <PostEditor />

          <TabsContent className="mt-0 pb-12" value="for-you">
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
