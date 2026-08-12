"use client";

import type { UserData } from "@asm/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { ListPlus, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useRef } from "react";
import FollowingFeed from "@/components/home/feedview/following";
import ForYouFeed from "@/components/home/for-you-feed";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import RightSideBar from "@/components/home/sidebars/right-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/search-field";
import PostEditor from "@/components/posts/editor/post-editor";

interface ClientHomeProps {
  userData: UserData;
}

type FeedTab = "for-you" | "global" | "following";

const TAB_TRIGGER_CLASS =
  "relative inline-flex h-full items-center justify-center rounded-none border-0 px-3 py-3 font-medium text-muted-foreground text-sm outline-none transition-all duration-200 ease-out after:absolute after:bottom-0 after:left-1/2 after:h-1 after:w-6 after:-translate-x-1/2 after:bg-gradient-to-b after:from-[#ff9500] after:to-[#e65500] after:opacity-0 after:transition-opacity after:content-[''] hover:bg-gradient-to-b hover:from-[#e4e7ec] hover:to-[#c6ccd5] hover:text-[#1c1f26] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1.5px_2px_rgba(255,255,255,0.9),0_0_0_1px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.05),0_2px_4px_rgba(0,0,0,0.06)] dark:hover:from-[#8f96a3] dark:hover:to-[#5c6370] dark:hover:text-white dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] data-[state=active]:px-8 data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:opacity-100 data-[state=active]:hover:bg-none data-[state=active]:hover:from-none data-[state=active]:hover:to-none data-[state=active]:hover:shadow-none data-[state=active]:hover:text-foreground";

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

  const feedScrollRef = useRef<HTMLDivElement>(null);

  if (!userData) {
    return null;
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="mx-auto flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={handleTabChange}
          value={tab}
        >
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
            <MobileTopBar />
            <div className="relative flex items-center border-border/60 border-b py-1.5">
              <TabsList className="flex h-full flex-1 items-center justify-center gap-0 bg-transparent p-0 md:justify-start">
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
              <div className="ml-auto hidden min-w-0 items-center gap-2 pr-1.5 md:flex">
                <div className="w-full max-w-[24rem] xl:max-w-md">
                  <SearchField />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="Create"
                      className="btn-3d flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all active:translate-y-px"
                      type="button"
                    >
                      <Plus className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="apple-panel min-w-[13rem] p-1.5 shadow-none"
                  >
                    <DropdownMenuItem
                      aria-disabled="true"
                      className="cursor-not-allowed rounded-md px-2 py-2 opacity-60"
                      disabled
                    >
                      <span className="flex items-center gap-3">
                        <ListPlus className="size-4" />
                        Create feed
                      </span>
                      <span className="ml-auto rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5 font-semibold text-[10px] text-muted-foreground tracking-wide">
                        Soon
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
              ref={feedScrollRef}
            >
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
            </div>
            <FeedScrollbar containerRef={feedScrollRef} />
          </div>
        </Tabs>
      </div>

      <RightSideBar />
      <MobileBottomNav />
    </div>
  );
};

export default ClientHome;
