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

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import FollowingFeed from "@/components/home/feedview/following";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import HomeFeed from "@/components/home/home-feed";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import RightSideBar from "@/components/home/sidebars/right-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/search-field";
import PostEditor from "@/components/posts/editor/post-editor";

interface ClientHomeProps {
  userData: UserData | null;
}

type FeedTab = "for-you" | "global" | "following";

const ClientHome: React.FC<ClientHomeProps> = ({ userData }) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);

  const tabParam = searchParams.get("tab");
  let tab: FeedTab = "global";
  if (tabParam === "for-you") {
    tab = "for-you";
  } else if (tabParam === "following") {
    tab = "following";
  }

  const handleTabChange = useCallback(
    (value: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (value === "for-you" || value === "following") {
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

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={handleTabChange}
          value={tab}
        >
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
            <MobileTopBar />
            <div className="border-border/60 relative flex items-center border-b py-1.5">
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
                {isLoggedIn ? (
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
                        <span className="border-border/60 bg-muted/50 text-muted-foreground ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
                          Soon
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto pb-16 lg:pb-0"
              ref={feedScrollRef}
            >
              {isLoggedIn ? <PostEditor /> : null}
              <TabsContent className="mt-0 pb-12" value="for-you">
                <HomeFeed variant="trending" />
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="global">
                <HomeFeed variant="global" />
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="following">
                {isLoggedIn ? (
                  <FollowingFeed />
                ) : (
                  <div className="px-4 py-10">
                    <AuthPromptCard
                      description="Follow people you love and their fleets will land right here."
                      imageSize={128}
                      title="Log in to see your feed"
                    />
                  </div>
                )}
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
