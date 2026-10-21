"use client";

import type { UserData } from "@asm/db";
import {
  discoveryFleetFeed,
  homeFeedTabs,
} from "@asm/ui/lib/home-feed-controls";
import type { DiscoveryFleetFeed } from "@asm/ui/lib/home-feed-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Tabs, TabsList } from "@asm/ui/shadui/tabs";
import { ListPlus, Plus } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/shell/auth-prompt-card";
import { FeedTabContent } from "@/components/feeds/feed-tab-content";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import FollowingFeed from "@/components/home/feedview/following";
import HomeFeed from "@/components/home/home-feed";
import { HomeFeedControls } from "@/components/home/home-feed-controls";
import RightSideBar from "@/components/home/sidebars/right-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import SearchField from "@/components/layouts/navigation/search-field";
import { CollapsibleTopBar } from "@/components/layouts/shell/collapsible-top-bar";
import PostEditor from "@/components/posts/editor/post-editor";
import { FeedSourceMenu } from "@/components/protocols/feed-source-menu";
import { useDiscoveryLocale } from "@/hooks/feed/use-discovery-locale";
import { useFeedScrollMemory } from "@/hooks/feed/use-feed-scroll-memory";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import { useFeedTabSelection } from "@/hooks/feed/use-feed-tab-selection";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import { requestFeedTop } from "@/lib/posts/feed-top-request";
import { useFeedSourceStore } from "@/store/feed-source-store";
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

const ClientHome: React.FC<ClientHomeProps> = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const memoryReady = useTabMemoryReady();
  const storedHome = useTabStore((state) => state.home);
  const setHomeTab = useTabStore((state) => state.setHomeTab);

  const tabParam = searchParams.get("tab");
  // Explicit ?tab= wins (shareable links); otherwise the remembered tab
  // restores, so leaving for a profile and coming back lands where you left.
  const resolvedTab: FeedTab = resolveHomeTab(
    tabParam,
    isLoggedIn,
    storedHome,
    memoryReady
  );
  const [tab, selectTab] = useFeedTabSelection(resolvedTab);
  const [rememberedDiscovery, setRememberedDiscovery] =
    useState<DiscoveryFleetFeed>("personalized");
  const discovery = discoveryFleetFeed(tab, rememberedDiscovery);
  if (discovery !== rememberedDiscovery) {
    setRememberedDiscovery(discovery);
  }

  // Adopt shared links (?tab=...) into memory so they survive navigation too.
  useEffect(() => {
    if (isTabValue(HOME_TABS, tabParam)) {
      setHomeTab(tabParam);
    }
  }, [setHomeTab, tabParam]);

  const handleTabChange = useCallback(
    (value: string) => {
      if (!isTabValue(HOME_TABS, value)) {
        return;
      }
      const nextParams = new URLSearchParams(window.location.search);
      const currentTab = nextParams.get("tab");
      if (value === (isTabValue(HOME_TABS, currentTab) ? currentTab : tab)) {
        requestFeedTop(`home:${value}`);
        return;
      }
      selectTab(value);
      setHomeTab(value);
      if (!isTabValue(HOME_TABS, nextParams.get("tab"))) {
        nextParams.set("tab", tab);
        window.history.replaceState(null, "", `${pathname}?${nextParams}`);
      }
      nextParams.set("tab", value);
      const query = nextParams.toString();
      window.history.pushState(
        null,
        "",
        query ? `${pathname}?${query}` : pathname
      );
    },
    [pathname, selectTab, setHomeTab, tab]
  );

  const feedScrollRef = useRef<HTMLDivElement>(null);
  const source = useFeedSourceStore((state) => state.source);
  const { locale } = useDiscoveryLocale();
  const hideTopBar = useHideOnScroll(feedScrollRef);
  // Each tab keeps its own scroll position: leaving for a post (or another
  // tab) and coming back lands exactly where you left.
  useFeedScrollMemory({
    containerRef: feedScrollRef,
    memoryKey:
      tab === "following" || source === "asm"
        ? `home:${tab}`
        : `home:${tab}:${source}:${locale}`,
  });

  // Swipe through visible tabs; the remembered discovery feed occupies one slot.
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const tabs = homeFeedTabs(discovery);
      const nextIndex =
        tabs.findIndex((entry) => entry.value === tab) + direction;
      const next = tabs[nextIndex];
      if (next) {
        handleTabChange(next.value);
      }
    },
    [discovery, handleTabChange, tab]
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
              <HomeFeedControls
                active={tab}
                discovery={discovery}
                onChange={handleTabChange}
                userId={user?.id}
              />
              <TabsList className="hidden h-full flex-1 items-center justify-center gap-0 bg-transparent p-0 md:flex md:justify-start">
                <AnimatedTabTrigger
                  active={tab === "personalized"}
                  layoutId="home-tab-indicator"
                  value="personalized"
                  onReselect={() => handleTabChange("personalized")}
                >
                  For you
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={tab === "latest"}
                  layoutId="home-tab-indicator"
                  value="latest"
                  onReselect={() => handleTabChange("latest")}
                >
                  Latest
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={tab === "trending"}
                  layoutId="home-tab-indicator"
                  value="trending"
                  onReselect={() => handleTabChange("trending")}
                >
                  Trending
                </AnimatedTabTrigger>
                <AnimatedTabTrigger
                  active={tab === "following"}
                  layoutId="home-tab-indicator"
                  value="following"
                  onReselect={() => handleTabChange("following")}
                >
                  Following
                </AnimatedTabTrigger>
              </TabsList>
              <FeedSourceMenu following={tab === "following"} />
              {/* Gutter between the settings button and the column edge. It lives
                  here rather than on the button because `ml-auto` on the search
                  cluster below zeroes out a sibling margin-right at xl. */}
              <div aria-hidden className="w-2 shrink-0" />
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
                      className="min-w-52 rounded-2xl! p-2"
                    >
                      <DropdownMenuItem
                        aria-disabled="true"
                        className="cursor-not-allowed rounded-lg px-2 py-2 opacity-60"
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
              <FeedTabContent
                activeTab={tab}
                className="mt-0 pb-12"
                value="personalized"
              >
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
              </FeedTabContent>

              <FeedTabContent
                activeTab={tab}
                className="mt-0 pb-12"
                value="latest"
              >
                <HomeFeed variant="latest" />
              </FeedTabContent>

              <FeedTabContent
                activeTab={tab}
                className="mt-0 pb-12"
                value="trending"
              >
                <HomeFeed variant="trending" />
              </FeedTabContent>

              <FeedTabContent
                activeTab={tab}
                className="mt-0 pb-12"
                value="following"
              >
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
              </FeedTabContent>
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
