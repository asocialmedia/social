"use client";

import type { CommunityData } from "@asm/db";
import { COMMUNITY_DISCOVERY_CATEGORIES } from "@asm/db/communities";
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
import { useCallback, useState } from "react";
import { useInView } from "react-intersection-observer";

import { useSession } from "@/app/(main)/session-provider";
import CommunitiesRightRail from "@/components/communities/communities-right-rail";
import CommunityCard from "@/components/communities/community-card";
import CommunityRail from "@/components/communities/community-rail";
import CreateCommunityDialog from "@/components/communities/create-community-dialog";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import CommunitiesPageSkeleton from "@/components/layouts/skeletons/communities-page-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useInfiniteCommunitiesQuery } from "@/lib/communities/client";
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
  // Sentinel parked where the search field sticks. While it is still in view
  // the field is resting over the hero art and must stay transparent (a tint
  // there reads as a stray band); once it scrolls off, the field is genuinely
  // stuck over the content below and needs a surface to sit on.
  const { inView: isSearchAtRest, ref: searchSentinelRef } = useInView({
    rootMargin: "-52px 0px 0px 0px",
    threshold: 0,
  });

  const query = useInfiniteCommunitiesQuery({ category, q: search });
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

  const handleCreate = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    setIsCreateOpen(true);
  }, [goToLogin, isLoggedIn]);

  const handleLoadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const isSearching = search.trim().length > 0;
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
    browseHeading = `Results for “${search.trim()}”`;
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
        <CommunitiesPageSkeleton />
        <MobileBottomNav />
        <CreateCommunityDialog
          onOpenChange={setIsCreateOpen}
          open={isCreateOpen}
        />
      </>
    );
  }

  return (
    <>
      {/* `communities-cq` makes this column the query container for the card
          width variable, so grid cards and rail cards read back the same size. */}
      <div className="communities-cq border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
        <MobileTopBar />

        <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto pb-16 lg:pb-0">
          {/* Category filter: the generalized shelves lead the page and stay
              pinned to the top of the scroll area. Horizontally scrollable (the
              chips are `shrink-0`, so without overflow-x they push the page
              wider than the viewport); `overscroll-x-contain` keeps a swipe
              from chaining out to the page. Same treatment as the app's other
              chip/rail strips. */}
          <div className="hide-native-scrollbar sticky top-0 z-20 flex gap-1.5 overflow-x-auto overscroll-x-contain bg-[hsl(var(--background-alt))]/95 px-5 py-2.5 backdrop-blur-md sm:px-8">
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

          {/* Brand backdrop wrapper: the art spans the statement, the search
              field and the first two rails, ending at Trending communities.
              Masked on every edge and kept faint, so the type always sits on a
              clean field - no vignette, no shadow behind the copy. */}
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden"
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
                    "linear-gradient(to bottom, transparent 0%, #000 8%, #000 88%, transparent 100%)",
                  maskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 8%, #000 88%, transparent 100%)",
                }}
              />
            </div>

            {/* Hero statement, sitting directly under the category strip so the
                directory is reachable without scrolling a full screen. */}
            <header className="relative px-5 pt-8 pb-6 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-5">
                {/* Statement, anchored to the top-left. Each line is its own
                    flex row so the inline brand mark centres against the type by
                    layout rather than hand-tuned baseline offsets. */}
                <div className="min-w-0">
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
                  <p className="text-muted-foreground mt-3 max-w-lg text-sm sm:text-base">
                    Find a new space to play, chill, and hang out.
                  </p>
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
                    { icon: UserRound, label: "Members", value: stats.members },
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

            {/* Sentinel: its position relative to the viewport (offset by the
                category strip's height) is what tells the search field whether
                it is resting or stuck. */}
            <div aria-hidden="true" ref={searchSentinelRef} />

            {/* Full-width search, directly below the statement. Pinned under
                the category strip (top-13 = the strip's 52px) so it rides
                along while the hero and curated rails scroll past. The surface
                only fades in once the field is actually stuck - at rest over
                the hero it stays transparent, so no band shows against the art.
                The z-index sits below the strip's and the 2px of overlap hides
                behind it rather than opening a seam. */}
            <div
              className={cn(
                // Symmetric padding (matching the category strip's py-2.5) so
                // the stuck field sits centred between the strip above and the
                // content below, with no extra band beneath it.
                "sticky top-13 z-10 px-5 py-2.5 transition-colors duration-200 sm:px-8",
                isSearchAtRest
                  ? "bg-transparent"
                  : "bg-[hsl(var(--background-alt))]/90 backdrop-blur-md"
              )}
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

            {/* The first two rails sit inside the backdrop wrapper, so the art
                carries through Trending and fades just past it. Each rail is
                rendered only when it has content, and the wrapper itself only
                when at least one does. */}
            {showTopRails ? (
              <div className="relative flex flex-col gap-8 pt-5 pb-8">
                {showJoinedRail ? (
                  <CommunityRail
                    communities={joined}
                    icon={Users}
                    auras={auras}
                    title="Joined communities"
                  />
                ) : null}
                {showTrendingRail ? (
                  <CommunityRail
                    communities={sections.trending}
                    icon={Flame}
                    auras={auras}
                    title="Trending communities"
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Growing fast sits past the backdrop, on the plain surface. */}
          {showGrowingRail ? (
            <div className="pt-8 pb-9">
              <CommunityRail
                communities={sections.growing}
                icon={Zap}
                auras={auras}
                title="Growing fast"
              />
            </div>
          ) : null}

          {/* All communities: the browsable, paginated grid. */}
          <div className="px-5 pb-10 sm:px-8">
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
              {query.isFetching && !query.isFetchingNextPage ? (
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
                <LoadMoreSkeleton />
              </InfiniteScrollContainer>
            ) : null}
          </div>
        </div>
      </div>

      <CommunitiesRightRail
        auras={auras}
        onCreate={handleCreate}
        onSelectCategory={setCategory}
        sidebar={sidebar}
      />

      <MobileBottomNav />
      <CreateCommunityDialog
        onOpenChange={setIsCreateOpen}
        open={isCreateOpen}
      />
    </>
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
