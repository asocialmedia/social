"use client";

import type { CommunityData } from "@asm/db";
import {
  COMMUNITY_DISCOVERY_CATEGORIES,
  COMMUNITY_MAX_OWNED,
} from "@asm/db/communities";
import { Button } from "@asm/ui/shadui/button";
import bannerAsm from "@assets/banner-asm.png";
import noSearchImage from "@assets/general/nosearch.png";
import zephImage from "@assets/zeph.png";
import {
  FileText,
  Flame,
  LayoutGrid,
  Plus,
  Search,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import CommunityCard from "@/components/communities/card/community-card";
import {
  CommunityCreateButton,
  CommunityCreationInfo,
} from "@/components/communities/create/community-create-button";
import CreateCommunityDialog from "@/components/communities/create/create-community-dialog";
import CommunitiesRightRail from "@/components/communities/rails/communities-right-rail";
import CommunityRail from "@/components/communities/rails/community-rail";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import { CollapsibleTopBar } from "@/components/layouts/shell/collapsible-top-bar";
import CommunitiesPageSkeleton from "@/components/layouts/skeletons/communities-page-skeleton";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import useDebounce from "@/hooks/use-debounce";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import {
  useCommunityCreationQuotaQuery,
  useInfiniteCommunitiesQuery,
} from "@/lib/communities/client";
import { useToast } from "@/lib/gooey-toast";
import { cn, formatNumber } from "@/lib/utils";

// Discovery page. A tall centred hero statement fills the fold, then the
// directory follows: the generalized category filter row, a full-width search
// field, the counted result total, and the community grid.
export default function ClientComm() {
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const { goToLogin } = useRequireAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // The page's own scroll container, so the mobile top bar can fold away on
  // scroll down and return on scroll up like the home and explore feeds.
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const searchSentinelRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Boundary markers for the ambient wash, in priority order: the wash runs
  // from the page top through the FIRST rail that renders (joined, else
  // trending, else growing fast), then hands off to the plain surface. Refereed
  // rather than hardcoded so the edge is measured, never a guess.
  const joinedRailRef = useRef<HTMLDivElement>(null);
  const trendingRailRef = useRef<HTMLDivElement>(null);
  const growingRailRef = useRef<HTMLDivElement>(null);
  const searchBandRef = useRef<HTMLDivElement>(null);
  // Live-measured heights. The category strip's real height varies with the
  // device's font metrics (two phones do not round the same), so the search
  // band's sticky offset is never a constant. The wash height is where the
  // first rail ends.
  const [stripH, setStripH] = useState(0);
  const [washH, setWashH] = useState(0);
  // True once the search field has pinned under the category strip. At rest the
  // field sits on the brand wash and must stay transparent so the art reads as
  // one continuous image; once stuck it needs an opaque band so scrolling
  // rails pass cleanly beneath it.
  const [isSearchStuck, setIsSearchStuck] = useState(false);
  const hideTopBar = useHideOnScroll(pageScrollRef);

  // The input updates on every keystroke, but the query only fires on the
  // settled value. Without this each character typed would run the ILIKE scan
  // behind the backend search (and one round trip per keypress); 300ms is the
  // same debounce the app's other search surfaces use.
  const debouncedSearch = useDebounce(search.trim(), 300);
  const isSearchPending = search.trim() !== debouncedSearch;
  const query = useInfiniteCommunitiesQuery({ category, q: debouncedSearch });

  // Watch the zero-height sentinel just above the sticky search. The field
  // pins exactly when the scroller has travelled past the sentinel's in-flow
  // position minus the category strip's height - all layout values
  // (`offsetTop`, `offsetHeight`, `scrollTop`), so there is no viewport-rect
  // math, no breakpoint mirror, and no fractional-DPR rounding to drift. The
  // strip height is measured live and published to state so the band's sticky
  // offset tracks it exactly; a constant leaves a hairline gap on any device
  // whose chip row rounds to a different height.
  //
  // `query.isLoading` is the dependency that matters: on the cold load the
  // component renders the skeleton first, so the first run finds both refs null
  // and bails. Without a re-run the empty-dep array would be stale for the life
  // of the page and the sticky search would stay permanently transparent.
  useEffect(() => {
    const sentinel = searchSentinelRef.current;
    const scroller = pageScrollRef.current;
    const strip = stripRef.current;
    if (!sentinel || !scroller || !strip) {
      return;
    }
    const update = () => {
      const h = strip.offsetHeight;
      setStripH(h);
      setIsSearchStuck(scroller.scrollTop >= sentinel.offsetTop - h - 1);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- re-run when the scroller mounts after the loading skeleton
  }, [query.isLoading]);

  // Bound the ambient wash to the first rail section. One continuous image
  // layer (never two faded copies with a dead seam), ending where the first
  // rendered rail ends - joined if the viewer has any, then trending, then
  // growing fast. A `ResizeObserver` on the content wrapper re-measures
  // whenever pagination, filtering, or the rails themselves change the layout.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const update = () => {
      const end =
        joinedRailRef.current ??
        trendingRailRef.current ??
        growingRailRef.current ??
        searchBandRef.current;
      if (end) {
        // Full strength through the whole first rail, then dissolve across the
        // standard 28px inter-section gap so the art is gone by the time the
        // next section's heading begins - it never sits in the fade over a card
        // or over the following heading.
        setWashH(end.offsetTop + end.offsetHeight + 28);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- re-run when the scroller mounts after the loading skeleton
  }, [query.isLoading]);
  const pages = query.data?.pages ?? [];
  const communities = pages.flatMap((page) => page.communities);
  // Auras arrive as one id -> aura map covering every community on the response.
  const auras = pages[0]?.auras ?? {};
  const counts = pages[0]?.counts ?? {};
  const joined = pages[0]?.joined ?? [];
  // Per-key defaults: a cached or older API payload may omit a section key, and
  // defaulting only the whole object would leave e.g. `top` undefined and throw
  // on `.length` downstream.
  const sections = {
    growing: pages[0]?.sections?.growing ?? [],
    trending: pages[0]?.sections?.trending ?? [],
  };
  const total = pages[0]?.total ?? 0;
  const stats = pages[0]?.stats ?? { communities: 0, members: 0, posts: 0 };
  // Per-key defaults for the same reason as sections: a cached/older payload
  // can omit the whole `sidebar` object or one of its lists.
  const sidebar = {
    activeCategory: pages[0]?.sidebar?.activeCategory ?? null,
    popular: pages[0]?.sidebar?.popular ?? [],
    recentVisits: pages[0]?.sidebar?.recentVisits ?? [],
    topByAura: pages[0]?.sidebar?.topByAura ?? [],
  };

  // The right rail disables its create button when the account is ineligible;
  // this is the safety net for the other entry points (the empty-shelf button)
  // so the wizard never opens only to fail on submit.
  const creationQuota = useCommunityCreationQuotaQuery(isLoggedIn);
  const { toast } = useToast();

  const handleCreate = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    const quota = creationQuota.data;
    if (quota && !quota.canCreate) {
      toast({
        description: quota.maxed
          ? `You've founded the maximum of ${COMMUNITY_MAX_OWNED} communities`
          : `Founding a community needs ${formatNumber(quota.nextRequirement ?? 0)} standing`,
        variant: "destructive",
      });
      return;
    }
    setIsCreateOpen(true);
  }, [creationQuota.data, goToLogin, isLoggedIn, toast]);

  const handleLoadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const isSearching = debouncedSearch.length > 0;
  const activeLabel =
    COMMUNITY_DISCOVERY_CATEGORIES.find((c) => c.key === category)?.label ??
    "All";
  // Curated rails restate nothing useful once a query or a filter is applied,
  // so they only render on the plain unfiltered view. Each rail is also gated
  // on having content: an empty section is hidden entirely rather than left as
  // a heading over blank space.
  const showRails = !isSearching && category === "all";
  const showJoinedRail = showRails && joined.length > 0;
  const showTrendingRail = showRails && sections.trending.length > 0;
  const showGrowingRail = showRails && sections.growing.length > 0;
  // The backdrop wrapper only earns its padding around the top rails when at
  // least one of them is actually rendered.
  const showTopRails = showJoinedRail || showTrendingRail;

  let browseHeading = "All communities";
  if (isSearching) {
    browseHeading = `Results for “${debouncedSearch}”`;
  } else if (category !== "all") {
    browseHeading = activeLabel;
  }

  // First paint: render the full page skeleton rather than a half-built page
  // (category chips reading "—", zeroed stats, an empty rails area). It mirrors
  // the real layout exactly, so the swap to live data does not shift anything.
  // keepPreviousData on the query means this only fires on the very first load,
  // never when switching category or search.
  if (query.isLoading) {
    return (
      <>
        <CommunitiesPageSkeleton isLoggedIn={isLoggedIn} />
        <MobileBottomNav hidden={false} />
        <CreateCommunityDialog
          onOpenChange={setIsCreateOpen}
          open={isCreateOpen}
        />
      </>
    );
  }

  // Category filter: the generalized shelves lead the page and stay
  // pinned to the top of the scroll area. Horizontally scrollable (the
  // chips are `shrink-0`, so without overflow-x they push the page
  // wider than the viewport); `overscroll-x-contain` keeps a swipe from
  // chaining out to the page. Same treatment as the app's other chip/rail strips.
  return (
    <>
      {/* `communities-cq` makes this column the query container for the card
          width variable, so grid cards and rail cards read back the same size. */}
      <div className="communities-cq border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
        <CollapsibleTopBar hidden={hideTopBar}>
          <MobileTopBar />
        </CollapsibleTopBar>
        <div
          className={cn(
            // `overscroll-y-contain` is load-bearing on touch devices: without
            // it a fling into the top/bottom edge chains out of this nested
            // scroller into the document (rubber-band + URL-bar resize). The
            // whole scroller then translates under its own sticky bands, so the
            // category strip slides up out of view and the search band gets
            // sliced in half while both hide-on-scroll signals oscillate.
            // Containing the overscroll keeps the bounce inside this container
            // (which has nothing further to give), so the stickies stay put.
            // `relative` scopes the ambient wash below to this scroll area.
            "hide-native-scrollbar relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain",
            isLoggedIn ? "pb-16 lg:pb-0" : "pb-24 lg:pb-12"
          )}
          ref={pageScrollRef}
        >
          {/* Single ambient brand wash for the top of the page: hero, search,
              and the first rail, then it hands off to the plain surface below.
              One continuous layer (never two faded copies with a dead seam),
              with its height measured from the first rail's real end. Mask
              fades are px-anchored so short and tall content both keep a clean
              entry under the category strip and a clean exit. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"
            style={washH > 0 ? { height: washH } : undefined}
          >
            <Image
              alt=""
              className="object-cover opacity-20 dark:opacity-15"
              fill
              priority
              sizes="100vw"
              src={bannerAsm}
              style={{
                WebkitMaskImage:
                  "linear-gradient(to bottom, transparent 0, #000 96px, #000 calc(100% - 28px), transparent 100%)",
                maskImage:
                  "linear-gradient(to bottom, transparent 0, #000 96px, #000 calc(100% - 28px), transparent 100%)",
              }}
            />
          </div>
          {/* Content rides above the wash. Plain `relative` (no z-index, no
              stacking context) so the sticky bands below still stick against
              the scroller over their full range. */}
          <div className="relative" ref={contentRef}>
            <div
              className="sticky top-0 z-20 bg-[hsl(var(--background-alt))]/95 backdrop-blur-md"
              ref={stripRef}
            >
              <div className="hide-native-scrollbar flex gap-1.5 overflow-x-auto overscroll-x-contain px-8 py-1.5 sm:py-2.5">
                {COMMUNITY_DISCOVERY_CATEGORIES.map((entry) => {
                  const isActive = entry.key === category;
                  const count = counts[entry.key];
                  return (
                    <button
                      className={cn(
                        // Rounded-square chips, not pills, so the filter row reads
                        // as a control strip rather than a row of badges.
                        "flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm whitespace-nowrap transition-all duration-200 ease-out",
                        isActive
                          ? "pill-nav-active"
                          : "pill-3d-hover text-muted-foreground hover:text-foreground border-transparent"
                      )}
                      key={entry.key}
                      onClick={() => setCategory(entry.key)}
                      type="button"
                    >
                      {entry.label}
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          isActive ? "opacity-70" : "text-muted-foreground/70"
                        )}
                      >
                        {count === undefined ? "—" : formatNumber(count)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Hero statement, sitting directly under the category strip so the
              directory is reachable without scrolling a full screen. It reads
              off the scroller-level wash above - no local art layer, so the
              type always sits on a clean field with no vignette behind it. */}
            <div className="relative">
              <header className="relative px-8 pt-8 pb-4 sm:pb-6">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-5">
                  {/* Statement, anchored to the top-left. Each line is its own
                    flex row so the inline brand mark centres against the type by
                    layout rather than hand-tuned baseline offsets.

                    `flex-auto` (grow with a content basis), NOT `flex-1`: the
                    line-break is decided on the content width, so the block
                    still wraps the stat panel below it on narrow screens, then
                    grows to fill the row so the (i) can ride the right edge. */}
                  <div className="min-w-0 flex-auto">
                    {/* The statement and, when the aura gate is unmet, the (i)
                      that explains it. `justify-between` pins the mark to the
                      row's right edge instead of tucking it against the
                      headline. */}
                    <div className="flex items-start justify-between gap-3">
                      <h1 className="text-foreground flex flex-col items-start text-3xl leading-[1.06] font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                        <span>Discover your</span>
                        <span className="flex items-center gap-[0.16em]">
                          <span>next</span>
                          <Image
                            alt="asocialmedia"
                            className="h-[1.2em] w-auto shrink-0"
                            priority
                            src={zephImage}
                          />
                          <span>community</span>
                        </span>
                      </h1>
                      <CommunityCreationInfo
                        className="mt-1 xl:hidden"
                        quota={creationQuota.data}
                      />
                    </div>
                    <p className="text-muted-foreground mt-3 max-w-lg text-sm sm:text-base">
                      Find a new space to play, chill, and hang out.
                    </p>
                    {/* The right rail is the create home on wide screens; below
                      xl it is absent, so the hero carries the action. It
                      renders nothing when the gate is unmet. */}
                    <div className="mt-5 w-full xl:hidden">
                      <CommunityCreateButton
                        onCreate={handleCreate}
                        quota={creationQuota.data}
                      />
                    </div>
                  </div>

                  {/* Right corner: the directory's headline totals as one
                    cohesive stat panel on the app's raised 3D surface. Each
                    column shares the same internal grid (icon + label on top,
                    number beneath) so the three line up across the row. The
                    panel hugs its content at every width - never stretched
                    edge-to-edge on mobile, just left-aligned under the
                    statement. */}
                  <dl className="sidebar-subcard flex shrink-0 items-start gap-5 rounded-2xl px-5 py-4 sm:gap-7">
                    {[
                      {
                        icon: Users,
                        label: "Communities",
                        value: stats.communities,
                      },
                      {
                        icon: UserRound,
                        label: "Members",
                        value: stats.members,
                      },
                      { icon: FileText, label: "Posts", value: stats.posts },
                    ].map((stat) => (
                      <div
                        className="flex min-w-0 flex-col gap-1"
                        key={stat.label}
                      >
                        <dt className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                          <stat.icon
                            aria-hidden="true"
                            className="text-primary size-3.5 shrink-0"
                            fill="currentColor"
                          />
                          {stat.label}
                        </dt>
                        <dd className="text-foreground text-2xl leading-none font-extrabold tabular-nums sm:text-3xl">
                          {formatNumber(stat.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </header>
            </div>

            {/* Sentinel and search stay direct children of the content wrapper
              (which spans the whole scroll area), never inside a short
              section: `position: sticky` is constrained to its parent's box,
              so housing the field in the hero would shove it straight up under
              the category strip and slice it in half. */}

            {/* Sentinel: a zero-height marker whose in-flow position (minus the
              measured strip height) is exactly where the search field pins,
              flipping the band opaque. */}
            <div aria-hidden="true" ref={searchSentinelRef} />
            <div
              className={cn(
                // The sticky offset is driven by the measured strip height (see
                // `stripH`): the band tucks 1px under the higher-z category
                // strip, sealing the subpixel crack where fractional-DPR
                // rounding would otherwise leak scrolling content through as a
                // visible gap-line. The top 1px is band padding, never content,
                // so nothing is clipped. `top-[45px]` / `sm:top-[53px]` stay as
                // the SSR/no-measure fallback.
                "sticky top-[45px] z-10 px-8 pt-2 pb-2 transition-colors duration-150 sm:top-[53px] sm:py-2.5",
                isSearchStuck
                  ? "bg-[hsl(var(--background-alt))]/95 backdrop-blur-md"
                  : "bg-transparent"
              )}
              ref={searchBandRef}
              style={stripH > 0 ? { top: stripH - 1 } : undefined}
            >
              <div className="search-panel-3d flex items-center gap-3 px-4">
                <Search className="text-muted-foreground size-4 shrink-0" />
                <input
                  aria-label="Search communities"
                  autoComplete="off"
                  className="text-foreground placeholder:text-muted-foreground h-12 w-full min-w-0 bg-transparent text-sm outline-none"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search communities"
                  type="text"
                  value={search}
                />
                {search ? (
                  <button
                    aria-label="Clear search"
                    className="text-muted-foreground hover:text-foreground shrink-0 rounded-full p-1 transition-colors"
                    onClick={() => setSearch("")}
                    type="button"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
            </div>
            {/* Each rail is rendered only when it has content, and the wrapper
              itself only when at least one does.

              The vertical rhythm on mobile is 32px between every section, and
              it is measured from the card EDGES. A rail's own track already
              contributes 4px of bottom padding, and the search field is given a
              matching 4px (`pb-1`) so every "source" hands over the same 4px.
              Each wrapper then only supplies the remaining 28px (`pt-7`). `pb-1`
              on the wrapper would stack a second 4px, so its padding is omitted
              on mobile and only restored at `sm`. Desktop keeps its original
              tighter rhythm. */}
            {showTopRails ? (
              // The top rails (Joined, Trending) read off the scroller-level
              // wash - no local art layer, so the hero, the search field and the
              // rails all sit on one continuous image with no seams.
              <div className="flex flex-col gap-7 pt-7 sm:gap-8 sm:pt-5 sm:pb-8">
                {showJoinedRail ? (
                  <div ref={joinedRailRef}>
                    <CommunityRail
                      communities={joined}
                      icon={Users}
                      auras={auras}
                      title="Joined communities"
                    />
                  </div>
                ) : null}
                {showTrendingRail ? (
                  <div ref={trendingRailRef}>
                    <CommunityRail
                      communities={sections.trending}
                      icon={Flame}
                      auras={auras}
                      title="Trending communities"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* Growing fast sits past the backdrop, on the plain surface.

              `pt-7` (28px) plus the 4px every source hands over (see the
              top-rails wrapper above) is the same 32px rhythm, whatever precedes
              it: the search field or another rail. `pb-7` (28px) plus the rail's
              own 4px track padding completes the 32px this rail sits in; the grid
              below then adds its own `pt-8` on top of that hand-off. Desktop
              keeps its original pt-8 / pb-9. */}
            {showGrowingRail ? (
              <div className="pt-7 pb-7 sm:pt-8 sm:pb-9" ref={growingRailRef}>
                <CommunityRail
                  communities={sections.growing}
                  icon={Zap}
                  auras={auras}
                  title="Growing fast"
                />
              </div>
            ) : null}
            {/* All communities: the browsable, paginated grid.

              `pt-8` on mobile is deliberate and larger than the 32px rail-to-rail
              rhythm: this is where the curated rails hand off to the browsable
              directory, so the heading needs to read as a new kind of section
              rather than one more rail. Desktop already separates them with its
              wider `pt-8 / pb-9` wrappers, so it needs no extra here. */}
            <div className="px-8 pt-8 pb-0 sm:pt-0 sm:pb-10">
              <div className="mb-3 flex items-center gap-2.5">
                <LayoutGrid
                  className="text-primary size-5 shrink-0"
                  fill="currentColor"
                />
                <h2 className="text-foreground text-lg font-bold tracking-tight">
                  {browseHeading}
                </h2>
              </div>

              {/* Result count: the filter's total, not the rendered page size. */}
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-muted-foreground text-sm">
                  <span className="text-foreground font-semibold tabular-nums">
                    {formatNumber(total)}
                  </span>{" "}
                  Results Found
                </p>
                {(query.isFetching && !query.isFetchingNextPage) ||
                isSearchPending ? (
                  <span className="text-muted-foreground text-xs">
                    Refreshing…
                  </span>
                ) : null}
              </div>

              <CommunityGrid
                auras={auras}
                communities={communities}
                isSearching={isSearching}
                label={activeLabel}
                onCreate={handleCreate}
              />

              {communities.length > 0 && query.hasNextPage ? (
                <InfiniteScrollContainer
                  className="pt-6"
                  onBottomReached={handleLoadMore}
                >
                  <CommunityLoadMore />
                </InfiniteScrollContainer>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <CommunitiesRightRail
        auras={auras}
        onCreate={handleCreate}
        onSelectCategory={setCategory}
        sidebar={sidebar}
      />

      {/* Same hide signal as the collapsible top bar above, so the dock and
          the top chrome move in lockstep instead of flickering against each
          other on separate scroll listeners. */}
      <MobileBottomNav hidden={hideTopBar} />
      <CreateCommunityDialog
        onOpenChange={setIsCreateOpen}
        open={isCreateOpen}
      />
    </>
  );
}

// Pagination placeholder shaped like the grid it extends: two community-card
// boxes at the same rhythm. The shared LoadMoreSkeleton renders tall post
// cards (avatar row + bento media), which read as a huge blank overflow gap
// under the last community while the next page loads on slow mobile links.
function CommunityLoadMore() {
  return (
    <div aria-hidden="true" className="community-grid">
      {[0, 1].map((index) => (
        <div
          className="sidebar-subcard flex animate-pulse flex-col overflow-hidden rounded-2xl"
          key={`community-load-more-${index}`}
        >
          <div className="bg-muted h-28 w-full sm:h-36" />
          <div className="flex flex-1 flex-col px-4 pb-4 sm:px-5 sm:pb-5">
            <div className="bg-muted -mt-8 size-14 rounded-xl sm:-mt-10 sm:size-18" />
            <div className="bg-muted mt-3 h-5 w-2/3 rounded-md" />
            <div className="bg-muted mt-1.5 h-3.5 w-1/3 rounded-md" />
            <div className="bg-muted mt-2 h-4 w-full rounded-md" />
            <div className="bg-muted mt-1.5 h-4 w-4/5 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CommunityGrid({
  auras,
  communities,
  isSearching,
  label,
  onCreate,
}: {
  auras: Record<string, number>;
  communities: CommunityData[];
  isSearching: boolean;
  label: string;
  onCreate: () => void;
}) {
  if (communities.length === 0) {
    return (
      <div className="sidebar-subcard flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
        <Image
          alt=""
          className="h-24 w-auto object-contain"
          draggable={false}
          height={128}
          src={noSearchImage}
          width={128}
        />
        <p className="text-foreground text-sm font-medium">
          {isSearching
            ? "No communities match that search"
            : `Nothing in ${label} yet`}
        </p>
        <p className="text-muted-foreground max-w-sm text-xs">
          {isSearching
            ? "Try a different name or topic, or start the community you were looking for."
            : "Be the first to plant a flag here."}
        </p>
        {/* A failed search is not an invitation to create - the reader was
            looking for something specific, and a create CTA here just competes
            with the results they were after. Only the genuinely-empty shelf
            offers it. */}
        {isSearching ? null : (
          <Button onClick={onCreate} size="sm" variant="outline">
            <Plus className="size-4" />
            Create community
          </Button>
        )}
      </div>
    );
  }

  return (
    // `.community-grid` owns the column count in globals.css (container-query
    // driven, so it responds to the content column's real width rather than the
    // viewport) and the rail cards read the same `community-card-w` width, so
    // grid cards and rail cards are identical at every size.
    <div className="community-grid">
      {communities.map((community) => (
        <CommunityCard
          aura={auras[community.id] ?? 0}
          community={community}
          key={community.id}
        />
      ))}
    </div>
  );
}
