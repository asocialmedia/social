"use client";

import type { UserData } from "@asm/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Tabs, TabsContent, TabsList } from "@asm/ui/shadui/tabs";
import { ListPlus, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import FollowingFeed from "@/components/home/feedview/following";
import HomeFeed from "@/components/home/home-feed";
import RightSideBar from "@/components/home/sidebars/right-side-bar";
import { CollapsibleTopBar } from "@/components/layouts/collapsible-top-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/search-field";
import PostEditor from "@/components/posts/editor/post-editor";
import { useFeedSwipeNavigation } from "@/hooks/use-feed-swipe-navigation";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";

interface ClientHomeProps {
  userData: UserData | null;
}

type FeedTab = "for-you" | "global" | "following";

const ClientHome: React.FC<ClientHomeProps> = () => {
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
  const hideTopBar = useHideOnScroll(feedScrollRef);

  // Mobile swipes drag the tab strip like a carousel: a left-to-right swipe
  // pulls in the tab on the left (Trending), right-to-left the one on the
  // right (Following).
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const order: FeedTab[] = ["for-you", "global", "following"];
      const nextIndex = order.indexOf(tab) + direction;
      if (nextIndex >= 0 && nextIndex < order.length) {
        handleTabChange(order[nextIndex]);
      }
    },
    [handleTabChange, tab]
  );
  useFeedSwipeNavigation(feedScrollRef, handleSwipeNavigate);

  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={handleTabChange}
          value={tab}
        >
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 backdrop-blur-md">
            <CollapsibleTopBar hidden={hideTopBar}>
              <MobileTopBar />
            </CollapsibleTopBar>
            <div className="border-border/60 relative flex items-center border-b py-1.5">
              <TabsList className="flex h-full flex-1 items-center justify-center gap-0 bg-transparent p-0 md:justify-start">
                <AnimatedTabTrigger
                  active={tab === "for-you"}
                  layoutId="home-tab-indicator"
                  value="for-you"
                >
                  Trending
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={tab === "global"}
                  layoutId="home-tab-indicator"
                  value="global"
                >
                  Global
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={tab === "following"}
                  layoutId="home-tab-indicator"
                  value="following"
                >
                  Following
                </AnimatedTabTrigger>
              </TabsList>
              {/* xl:hidden: the right sidebar owns the search bar from xl up;
                  this header copy serves the md-xl gap. */}
              <div className="ml-auto hidden min-w-0 items-center gap-2 pr-1.5 md:flex xl:hidden">
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
                      className="apple-panel min-w-52 p-1.5 shadow-none"
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
              className={`hide-native-scrollbar h-full touch-pan-y overflow-x-hidden overflow-y-auto ${
                isLoggedIn ? "pb-16 lg:pb-0" : "pb-44 lg:pb-20"
              }`}
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
                      className="mx-auto w-full max-w-md"
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
    </>
  );
};

export default ClientHome;
