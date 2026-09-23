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
import { useCallback, useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/shell/auth-prompt-card";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import FollowingFeed from "@/components/home/feedview/following";
import HomeFeed from "@/components/home/home-feed";
import RightSideBar from "@/components/home/sidebars/right-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/navigation/search-field";
import { CollapsibleTopBar } from "@/components/layouts/shell/collapsible-top-bar";
import PostEditor from "@/components/posts/editor/post-editor";
import { useFeedScrollMemory } from "@/hooks/feed/use-feed-scroll-memory";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import {
  HOME_TABS,
  isTabValue,
  resolveHomeTab,
  useTabMemoryReady,
  useTabStore,
} from "@/store/tab-store";
import type { HomeTab } from "@/store/tab-store";

interface ClientHomeProps {
  userData: UserData | null;
}

type FeedTab = HomeTab;

const HOME_TAB_VALUES: readonly FeedTab[] = [
  "personalized",
  "latest",
  "trending",
  "following",
];

const ClientHome: React.FC<ClientHomeProps> = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const memoryReady = useTabMemoryReady();
  const storedHome = useTabStore((state) => state.home);
  const setHomeTab = useTabStore((state) => state.setHomeTab);

  const tabParam = searchParams.get("tab");
  const defaultTab: FeedTab = isLoggedIn ? "personalized" : "latest";
  // Explicit ?tab= wins (shareable links); otherwise the remembered tab
  // restores, so leaving for a profile and coming back lands where you left.
  const tab: FeedTab = resolveHomeTab(
    tabParam,
    isLoggedIn,
    storedHome,
    memoryReady
  );

  // Adopt shared links (?tab=...) into memory so they survive navigation too.
  useEffect(() => {
    if (isTabValue(HOME_TABS, tabParam)) {
      setHomeTab(tabParam);
    }
  }, [setHomeTab, tabParam]);

  const handleTabChange = useCallback(
    (value: string) => {
      if (isTabValue(HOME_TABS, value)) {
        setHomeTab(value);
      }
      const nextParams = new URLSearchParams(searchParams.toString());
      if (value === defaultTab) {
        nextParams.delete("tab");
      } else if (isTabValue(HOME_TABS, value)) {
        nextParams.set("tab", value);
      } else {
        nextParams.delete("tab");
      }
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [defaultTab, pathname, router, searchParams, setHomeTab]
  );

  const feedScrollRef = useRef<HTMLDivElement>(null);
  const hideTopBar = useHideOnScroll(feedScrollRef);
  // Each tab keeps its own scroll position: leaving for a post (or another
  // tab) and coming back lands exactly where you left.
  useFeedScrollMemory({
    containerRef: feedScrollRef,
    memoryKey: `home:${tab}`,
  });

  // Mobile swipes drag the tab strip like a carousel from personalized to
  // latest, trending, and finally following.
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = HOME_TAB_VALUES.indexOf(tab) + direction;
      if (nextIndex >= 0 && nextIndex < HOME_TAB_VALUES.length) {
        handleTabChange(HOME_TAB_VALUES[nextIndex]);
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
                  active={tab === "personalized"}
                  layoutId="home-tab-indicator"
                  value="personalized"
                >
                  For you
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={tab === "latest"}
                  layoutId="home-tab-indicator"
                  value="latest"
                >
                  Latest
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={tab === "trending"}
                  layoutId="home-tab-indicator"
                  value="trending"
                >
                  Trending
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
                      align="start"
                      className="min-w-52 p-1.5"
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
                isLoggedIn ? "pb-24 lg:pb-0" : "pb-44 lg:pb-20"
              }`}
              ref={feedScrollRef}
            >
              {isLoggedIn ? <PostEditor /> : null}
              <TabsContent className="mt-0 pb-12" value="personalized">
                {isLoggedIn ? (
                  <HomeFeed variant="personalized" />
                ) : (
                  <div className="px-4 py-10">
                    <AuthPromptCard
                      className="mx-auto w-full max-w-md"
                      description="Your feed will learn from what you read, amplify, bookmark, and discuss."
                      imageSize={128}
                      title="Log in for a feed made for you"
                    />
                  </div>
                )}
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="latest">
                <HomeFeed variant="latest" />
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="trending">
                <HomeFeed variant="trending" />
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
