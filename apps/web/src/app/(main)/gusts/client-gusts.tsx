"use client";
import type { GustsPage, UserData } from "@asm/db";
import { filterExternalRecommendations } from "@asm/protocols/discovery";
import {
  advanceGustHeader,
  followingGustAvatars,
} from "@asm/ui/lib/gust-header";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronUp, Plus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, {
  Activity,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInView } from "react-intersection-observer";

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/shell/auth-prompt-card";
import { FeedErrorState } from "@/components/feeds/feed-error-state";
import { NewContentPill } from "@/components/feeds/new-content-pill";
import type { NewContentAuthor } from "@/components/feeds/new-content-pill";
import { GustCard } from "@/components/gusts/gust-card";
import { GustCardSkeleton } from "@/components/gusts/gust-card-skeleton";
import { GustFeedControls } from "@/components/gusts/gust-feed-controls";
import type { GustFeed } from "@/components/gusts/gust-feed-controls";
import {
  GustFeedErrorState,
  GustSourceRetries,
} from "@/components/gusts/gust-source-retries";
import {
  GustStreamSlot,
  useGustStreamSlots,
} from "@/components/gusts/gust-stream-slot";
import { GustsCommentsDrawer } from "@/components/gusts/gusts-comments-drawer";
import { MobileGustEddies } from "@/components/gusts/mobile-gust-eddies";
import Spinner3D from "@/components/layouts/feedback/spinner-3d";
import { FeedSourceMenu } from "@/components/protocols/feed-source-menu";
import { useBlueskyFeed } from "@/components/protocols/use-bluesky-feed";
import { useExternalPost } from "@/components/protocols/use-external-post";
import { RecommendationTracker } from "@/components/recommendations/recommendation-tracker";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useBoundedSourcePending } from "@/hooks/feed/use-bounded-source-pending";
import { useDiscoveryLocale } from "@/hooks/feed/use-discovery-locale";
import { useFeedExposures } from "@/hooks/feed/use-feed-exposures";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import { useMediaQuery } from "@/hooks/use-media-query";
import kyInstance from "@/lib/ky";
import { preloadVideoDelivery } from "@/lib/media/use-video-delivery";
import {
  FEED_QUERY_BEHAVIOR,
  prependPostsToFeedCache,
} from "@/lib/posts/feed-cache";
import {
  consumeFeedTop,
  subscribeFeedTopRequests,
} from "@/lib/posts/feed-top-request";
import {
  advanceGustPaging,
  gustPagingDelay,
  gustPagingState,
  mergeGustPosts,
  readGustPage,
} from "@/lib/posts/gust-feed";
import {
  activeNetworkInterests,
  networkPostAllowed,
  networkPostRecommended,
} from "@/lib/posts/network-content-policy";
import { externalPostView } from "@/lib/posts/presentation";
import type { PresentedPost } from "@/lib/posts/presentation";
import { cn, isEditableTarget } from "@/lib/utils";
import { useComposerStore } from "@/store/composer-store";
import {
  useFeedSourceStore,
  useExternalExclusions,
} from "@/store/feed-source-store";

interface ClientGustsProps {
  loggedInUserData: UserData | null;
}

// The exact 3D metallic hover the Home tab strip uses (see
// AnimatedTabTrigger). Copied verbatim so the gust tabs respond identically;
// the active tab opts out, just like Home, since its orange underline is
// already the state cue.
const GUST_TAB_HOVER_CLASS =
  "hover:bg-gradient-to-b hover:from-[#e4e7ec] hover:to-[#c6ccd5] hover:text-[#1c1f26] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1.5px_2px_rgba(255,255,255,0.9),0_0_0_1px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.05),0_2px_4px_rgba(0,0,0,0.06)] dark:hover:from-[#8f96a3] dark:hover:to-[#5c6370] dark:hover:text-white dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

// Shared tab: plain text centred over the clip (Instagram Reels style), with a
// thin orange sliding underline for the active label. Used at every breakpoint
// so the reel owns the full screen instead of sitting under a header bar.
function GustTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "relative rounded-none px-3 pt-1.5 pb-2 text-sm transition-all duration-200 ease-out",
        // Resting tabs sit on video, so legibility leans on a text shadow;
        // the hover surface supplies its own contrast, so the shadow drops.
        "[text-shadow:0_1px_4px_rgba(0,0,0,0.6)] hover:text-shadow-none",
        active
          ? "font-semibold text-white"
          : cn("font-medium text-white/70", GUST_TAB_HOVER_CLASS)
      )}
      onClick={onClick}
      type="button"
    >
      {label}
      {active ? (
        <motion.span
          aria-hidden
          className="absolute inset-x-0 bottom-0.5 mx-auto h-1 w-6 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]"
          layoutId="gust-tab-underline"
          transition={{ damping: 34, stiffness: 420, type: "spring" }}
        />
      ) : null}
    </button>
  );
}

export const ClientGusts: React.FC<ClientGustsProps> = () => {
  const params = useSearchParams();
  const { user } = useSession();
  const requested = params.get("tab");
  let active: GustFeed = user ? "personalized" : "latest";
  if (
    requested === "following" ||
    requested === "personalized" ||
    requested === "latest"
  ) {
    active = requested;
  }
  const [visited, setVisited] = useState<ReadonlySet<GustFeed>>(
    () => new Set([active])
  );
  if (!visited.has(active)) {
    setVisited(new Set([...visited, active]));
  }
  return (
    <div className="relative flex min-w-0 flex-1">
      {(["latest", "personalized", "following"] as const).map((tab) => (
        <Activity key={tab} mode={active === tab ? "visible" : "hidden"}>
          {visited.has(tab) ? <GustStream gustTab={tab} /> : null}
        </Activity>
      ))}
    </div>
  );
};

const GustStream = ({ gustTab }: { gustTab: GustFeed }) => {
  const reducedMotion = useReducedMotion();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const initialPostId = searchParams.get("id");
  const externalId = initialPostId?.startsWith("at://") ? initialPostId : "";
  const deepLink = useExternalPost(externalId);
  const { user } = useSession();
  const oppositeSeen = useFeedExposures(user?.id ?? "guest", "gusts", gustTab);
  const { goToLogin } = useRequireAuth();
  const openComposer = useComposerStore((state) => state.openComposer);
  const autoOpenCreate = searchParams.get("create") === "true";
  const queryClient = useQueryClient();
  const isLoggedIn = Boolean(user);
  const isPersonalized = gustTab === "personalized" && !initialPostId;
  // For you is ranked from the viewer's own watch/amplify signals, so it is
  // account-only. A guest who opens it gets a sign-in prompt instead of a
  // feed, and nothing is fetched; a ?id= deep link is chronological and stays
  // viewable.
  const gatedPersonalized =
    gustTab !== "latest" && !initialPostId && !isLoggedIn;

  const [activeIndex, setActiveIndex] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(true);
  const headerScroll = useRef({ anchor: 0, visible: true });
  const [isMuted, setIsMuted] = useState(true);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    const handleNotInterested = (event: Event) => {
      const postId = (event as CustomEvent<{ postId?: string }>).detail?.postId;
      if (!postId) {
        return;
      }
      setHiddenPostIds((current) => new Set([...current, postId]));
    };
    const handleInterested = (event: Event) => {
      const postId = (event as CustomEvent<{ postId?: string }>).detail?.postId;
      if (!postId) {
        return;
      }
      setHiddenPostIds((current) => {
        if (!current.has(postId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(postId);
        return next;
      });
    };
    window.addEventListener(
      "recommendation:not-interested",
      handleNotInterested
    );
    window.addEventListener("recommendation:interested", handleInterested);
    return () => {
      window.removeEventListener(
        "recommendation:not-interested",
        handleNotInterested
      );
      window.removeEventListener("recommendation:interested", handleInterested);
    };
  }, []);

  // Restore the saved video mute preference after hydration so a gust the user
  // muted stays muted (or unmuted) across page loads. The lazy default stays
  // true to avoid an SSR/hydration mismatch; this effect reconciles it once.
  useEffect(() => {
    const stored = localStorage.getItem("gust-video-muted");
    if (stored !== null) {
      // Deferred so the preference applies right after the first paint.
      queueMicrotask(() => setIsMuted(stored === "true"));
    }
  }, []);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollToFeedTop = useCallback(() => {
    containerRef.current?.scrollTo({
      behavior: reducedMotion ? "auto" : "smooth",
      top: 0,
    });
    setHeaderVisible(true);
  }, [reducedMotion]);
  useEffect(
    () =>
      subscribeFeedTopRequests(() => {
        if (consumeFeedTop(`gusts:${gustTab}`)) {
          scrollToFeedTop();
        }
      }),
    [gustTab, scrollToFeedTop]
  );

  const handleTabChange = useCallback(
    (value: GustFeed) => {
      if (value === gustTab && !initialPostId) {
        scrollToFeedTop();
        return;
      }
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("id");
      nextParams.set("tab", value);
      const query = nextParams.toString();
      window.history.pushState(
        null,
        "",
        query ? `${pathname}?${query}` : pathname
      );
    },
    [gustTab, initialPostId, pathname, scrollToFeedTop, searchParams]
  );

  // The app-wide infinite-scroll pattern (same hook the feeds use): a bottom
  // sentinel flips inView when it enters the viewport, which paginates even
  // when the list is too short to scroll.
  const { inView: isEndVisible, ref: endSentinelRef } = useInView({
    rootMargin: "3000px",
  });

  const source = useFeedSourceStore((state) => state.source);
  const network = useNetworkSettings();
  const { locale } = useDiscoveryLocale();
  const excluded = useExternalExclusions(user?.id ?? "guest");
  const includeNative =
    !externalId &&
    (Boolean(initialPostId) || source !== "bluesky" || gustTab === "following");
  const includeExternal =
    !gatedPersonalized &&
    gustTab !== "following" &&
    !initialPostId &&
    source !== "asm";
  useEffect(() => {
    if (!gatedPersonalized) {
      void preloadVideoDelivery();
    }
  }, [gatedPersonalized]);
  const handleUnavailable = useCallback((postId: string) => {
    setHiddenPostIds((previous) => new Set([...previous, postId]));
  }, []);
  const externalFeed = useBlueskyFeed(
    gustTab === "personalized" ? "personalized" : "latest",
    includeExternal,
    user?.id ?? "guest",
    "video"
  );

  const queryKey = useMemo(
    () => [
      "gusts-feed",
      externalId ? null : initialPostId,
      gustTab,
      user?.id ?? "guest",
      network.scope,
      locale,
    ],
    [gustTab, initialPostId, externalId, user?.id, network.scope, locale]
  );

  // Infinite query for gusts
  const {
    data,
    fetchNextPage: fetchNativeNextPage,
    hasNextPage: hasNativeNextPage,
    isFetchedAfterMount,
    isFetching: isFetchingNative,
    isFetchingNextPage: isFetchingNativeNextPage,
    refetch: refetchNative,
    status: nativeStatus,
    isFetchNextPageError: nativePageError,
  } = useInfiniteQuery({
    enabled:
      !gatedPersonalized && includeNative && !externalId && network.ready,
    getNextPageParam: (lastPage: GustsPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      // Moderated gusts never render in the stream (same as the explore rail).
      const queryParams: Record<string, string> = {
        excludeModerated: "1",
        locale,
        profile: network.settings.preferences.activeProfileId,
        ...(initialPostId ? {} : { network: network.scope }),
      };
      if (isPersonalized) {
        queryParams.mode = "personalized";
      } else if (gustTab === "following" && !initialPostId) {
        queryParams.mode = "following";
      }
      const current = queryClient.getQueryData<{
        pages: GustsPage[];
        pageParams: (string | null)[];
      }>(queryKey);
      const known = new Set(
        current?.pages.flatMap((page) => page.posts.map((post) => post.id))
      );
      return readGustPage<GustsPage>(
        (cursor) =>
          kyInstance.get("/api/gusts", {
            searchParams: cursor
              ? { ...queryParams, cursor }
              : {
                  ...queryParams,
                  ...(initialPostId ? { initialId: initialPostId } : {}),
                },
            signal,
            throwHttpErrors: false,
          }),
        pageParam,
        known
      );
    },
    queryKey,
    ...FEED_QUERY_BEHAVIOR,
  });

  const nativePosts = useMemo(
    () =>
      includeNative && !externalId && network.ready
        ? [
            ...new Map(
              (data?.pages.flatMap((page) => page.posts) ?? []).map((post) => [
                post.id,
                post,
              ])
            ).values(),
          ].filter(
            (post) =>
              !post.moderated &&
              !hiddenPostIds.has(post.id) &&
              (!isPersonalized || !oppositeSeen.has(post.id)) &&
              (gustTab === "following" || initialPostId
                ? networkPostAllowed(
                    post,
                    network.settings.preferences,
                    network.settings.topicScope
                  )
                : networkPostRecommended(
                    post,
                    network.settings.preferences,
                    network.settings.topicScope
                  )) &&
              post.attachments.some((media) => media.type === "VIDEO")
          )
        : [],
    [
      data,
      includeNative,
      externalId,
      hiddenPostIds,
      oppositeSeen,
      isPersonalized,
      gustTab,
      initialPostId,
      network.settings.preferences,
      network.settings.topicScope,
      network.ready,
    ]
  );
  const externalPosts = useMemo(() => {
    if (!network.ready) {
      return [];
    }
    let candidates = includeExternal
      ? (externalFeed.data?.pages.flatMap((page) => page.items) ?? [])
      : [];
    if (externalId) {
      candidates = deepLink.data ? [deepLink.data] : [];
    }
    return filterExternalRecommendations(candidates, excluded)
      .filter((post) => !isPersonalized || !oppositeSeen.has(post.id))
      .filter((post) => post.media.some((media) => media.type === "video"))
      .map((post) => ({ ...externalPostView(post), isGust: true }))
      .filter((post) =>
        externalId
          ? networkPostAllowed(
              post,
              network.settings.preferences,
              network.settings.topicScope
            )
          : networkPostRecommended(
              post,
              network.settings.preferences,
              network.settings.topicScope
            )
      );
  }, [
    externalId,
    deepLink.data,
    includeExternal,
    externalFeed.data,
    excluded,
    oppositeSeen,
    isPersonalized,
    network.settings.preferences,
    network.settings.topicScope,
    network.ready,
  ]);
  const orderScope = `${gustTab}:${initialPostId ?? ""}:${source}:${user?.id ?? "guest"}:${network.scope}:${locale}`;
  const sourcesPending = useBoundedSourcePending(
    includeNative &&
      includeExternal &&
      (nativeStatus === "pending" || externalFeed.isPending)
  );
  const [reel, setReel] = useState<{
    scope: string;
    native: typeof nativePosts;
    external: typeof externalPosts;
    posts: PresentedPost[];
    pending: boolean;
  }>({
    external: externalPosts,
    native: nativePosts,
    pending: sourcesPending,
    posts: mergeGustPosts([], nativePosts, externalPosts, sourcesPending),
    scope: orderScope,
  });
  let { posts } = reel;
  if (
    reel.scope !== orderScope ||
    reel.native !== nativePosts ||
    reel.external !== externalPosts ||
    reel.pending !== sourcesPending
  ) {
    posts = mergeGustPosts(
      reel.scope === orderScope ? reel.posts : [],
      nativePosts,
      externalPosts,
      sourcesPending
    );
    setReel({
      external: externalPosts,
      native: nativePosts,
      pending: sourcesPending,
      posts,
      scope: orderScope,
    });
  }
  const loadedPageCount =
    (includeNative ? (data?.pages.length ?? 0) : 0) +
    (includeExternal ? (externalFeed.data?.pages.length ?? 0) : 0);
  // Count what the servers returned, not what survived client-side policy and
  // exposure filtering. Otherwise a strict filter looks like an empty page and
  // pins the reel in permanent backoff.
  const serverRows =
    (data?.pages.flatMap((page) => page.posts).length ?? 0) +
    (externalFeed.data?.pages.flatMap((page) => page.items).length ?? 0);
  const [pagingProgress, setPagingProgress] = useState({
    emptyPages: 0,
    pages: loadedPageCount,
    scope: orderScope,
    visible: serverRows,
  });
  let currentPagingProgress = pagingProgress;
  if (
    pagingProgress.scope !== orderScope ||
    pagingProgress.pages !== loadedPageCount ||
    pagingProgress.visible !== serverRows
  ) {
    currentPagingProgress = advanceGustPaging(
      pagingProgress,
      orderScope,
      loadedPageCount,
      serverRows
    );
    setPagingProgress(currentPagingProgress);
  }
  const pagingDelay = gustPagingDelay(currentPagingProgress.emptyPages);
  const { canFetchNextPage, hasNextPage, isFetchingNextPage, pageError } =
    gustPagingState([
      {
        enabled: includeNative,
        hasNextPage: hasNativeNextPage,
        isFetchNextPageError: nativePageError,
        isFetchingNextPage: isFetchingNativeNextPage,
      },
      {
        enabled: includeExternal,
        hasNextPage: externalFeed.hasNextPage,
        isFetchNextPageError: externalFeed.isFetchNextPageError,
        isFetchingNextPage: externalFeed.isFetchingNextPage,
      },
    ]);
  const streamSlots = useGustStreamSlots(
    posts.map((post) => post.id),
    hasNextPage,
    orderScope
  );
  const prependAnchor = useRef<{ id: string; offset: number } | null>(null);
  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    const container = containerRef.current;
    if (!anchor || !container) {
      return;
    }
    const index = posts.findIndex((post) => post.id === anchor.id);
    const element = itemRefs.current[index];
    if (element) {
      container.scrollTo({
        top: element.offsetTop - container.offsetTop - anchor.offset,
      });
      prependAnchor.current = null;
    }
  }, [posts]);
  const {
    refetch: refetchExternal,
    fetchNextPage: fetchExternalNextPage,
    hasNextPage: hasExternalNextPage,
    isFetchNextPageError: externalPageError,
    showNewItems: showExternalNewItems,
  } = externalFeed;
  const { refetch: refetchDeepLink } = deepLink;
  const fetchNextPage = useCallback(async () => {
    await Promise.all([
      includeNative && hasNativeNextPage && !nativePageError
        ? fetchNativeNextPage({ cancelRefetch: false })
        : undefined,
      includeExternal && hasExternalNextPage && !externalPageError
        ? fetchExternalNextPage({ cancelRefetch: false })
        : undefined,
    ]);
  }, [
    includeNative,
    hasNativeNextPage,
    nativePageError,
    fetchNativeNextPage,
    includeExternal,
    hasExternalNextPage,
    externalPageError,
    fetchExternalNextPage,
  ]);
  const refetch = useCallback(async () => {
    await Promise.all([
      includeNative && !externalId ? refetchNative() : undefined,
      includeExternal ? refetchExternal() : undefined,
      externalId ? refetchDeepLink() : undefined,
    ]);
  }, [
    includeNative,
    externalId,
    refetchNative,
    includeExternal,
    refetchExternal,
    refetchDeepLink,
  ]);
  let status = nativeStatus;
  if (externalId) {
    ({ status } = deepLink);
  } else if (
    (includeNative && nativeStatus === "pending") ||
    (includeExternal && externalFeed.isPending)
  ) {
    status = "pending";
  } else if (
    (includeNative && nativeStatus === "error") ||
    (includeExternal && externalFeed.isError)
  ) {
    status = "error";
  } else {
    status = "success";
  }
  if (posts.length) {
    status = "success";
  }
  const [positionScope, setPositionScope] = useState(orderScope);
  if (positionScope !== orderScope) {
    setPositionScope(orderScope);
    setActiveIndex(0);
    setIsCommentsOpen(false);
  }
  const scrollScope = useRef(orderScope);
  useEffect(() => {
    if (scrollScope.current !== orderScope) {
      scrollScope.current = orderScope;
      containerRef.current?.scrollTo({ top: 0 });
    }
  }, [orderScope]);

  const followingPreview = useQuery({
    enabled: isLoggedIn && gustTab !== "following",
    queryFn: () =>
      kyInstance
        .get("/api/gusts", {
          searchParams: { excludeModerated: "1", mode: "following", take: "5" },
        })
        .json<GustsPage>(),
    queryKey: ["following-gust-preview", user?.id ?? "guest", network.scope],
    staleTime: 60_000,
  });
  const orderedFollowingAvatars = followingGustAvatars(
    gustTab === "following"
      ? nativePosts
      : (followingPreview.data?.posts ?? []),
    gustTab === "following" ? activeIndex : 0
  );
  const followingPeople = useQuery({
    enabled:
      isLoggedIn &&
      orderedFollowingAvatars.length === 0 &&
      (gustTab === "following"
        ? data !== undefined
        : followingPreview.isSuccess || followingPreview.isError),
    queryFn: () =>
      kyInstance
        .get(`/api/users/${encodeURIComponent(user?.id ?? "")}/following-list`)
        .json<{ avatarUrl: string | null; id: string; username: string }[]>(),
    queryKey: ["gust-header-following-people", user?.id ?? "guest"],
    staleTime: 60_000,
  });
  const followingAvatars = orderedFollowingAvatars.length
    ? orderedFollowingAvatars
    : (followingPeople.data?.slice(0, 3) ?? []);
  const headerShown = headerVisible && !(isCommentsOpen && isMobile);

  // Head-only probe: new clips collect in `newGusts` and surface as an avatar
  // badge without replacing the reel or moving the viewer. Only the badge tap
  // merges them in. The video filter matches what the reel actually renders.
  const { clearNewItems, newItems: newGusts } = useNewContentProbe({
    enabled:
      gustTab === "following" &&
      includeNative &&
      !initialPostId &&
      !gatedPersonalized &&
      network.ready &&
      nativeStatus === "success",
    fetchHead: async (signal) => {
      const queryParams: Record<string, string> = {
        excludeModerated: "1",
        locale,
        network: network.scope,
        profile: network.settings.preferences.activeProfileId,
      };
      if (gustTab === "following" && !initialPostId) {
        queryParams.mode = "following";
      }
      // Following gust heads are newest-first, so a single row answers "is there
      // anything new". Only pay for a hydrated page when the answer is yes.
      const probe = await kyInstance
        .get("/api/gusts", {
          searchParams: { ...queryParams, take: "1" },
          signal,
        })
        .json<GustsPage>();
      const [newest] = probe.posts;
      if (!newest || nativePosts.some((post) => post.id === newest.id)) {
        return [];
      }
      const fresh = await kyInstance
        .get("/api/gusts", { searchParams: queryParams, signal })
        .json<GustsPage>();
      return fresh.posts;
    },
    filter: (post) =>
      post.attachments.some((media) => media.type === "VIDEO") &&
      (gustTab === "following"
        ? networkPostAllowed(
            post,
            network.settings.preferences,
            network.settings.topicScope
          )
        : networkPostRecommended(
            post,
            network.settings.preferences,
            network.settings.topicScope
          )),
    probeOnMount: !isFetchedAfterMount,
    resetKey: orderScope,
    visible: nativePosts,
  });

  const allNewGusts = [
    ...newGusts,
    ...externalFeed.newItems
      .map((post) => ({
        ...externalPostView(post),
        isGust: true,
      }))
      .filter((post) =>
        networkPostRecommended(
          post,
          network.settings.preferences,
          network.settings.topicScope
        )
      ),
  ];

  // Pull-to-refresh deliberately updates the visible reel: it is the explicit
  // "show me now" gesture. New clips that arrive on their own wait behind the
  // badge instead so scrolling never jumps unexpectedly.
  const refreshFeed = useCallback(async () => {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    try {
      await refetch();
      setPullDistance(0);
      setIsRefreshing(false);
    } catch (error) {
      // Reset before rethrowing so the refresh UI clears on the failure path
      // too (replaces the previous `finally` clause).
      setIsRefreshing(false);
      setPullDistance(0);
      throw error;
    }
    // oxlint-disable-next-line react/memo-dependencies -- refetch is lexically captured; React Query guarantees it has a stable identity
  }, [isRefreshing, refetch]);

  // Jump to the very first gust and merge the probed clips into the reel.
  // Prepend the probed clips without tearing the reel down. Emptying the merged
  // list forced a rebuild from scratch, which unmounted every mounted video and
  // smooth-scrolled from the current clip all the way back to the top.
  const showNewGusts = useCallback(() => {
    const watched = posts[activeIndex];
    const element = itemRefs.current[activeIndex];
    const container = containerRef.current;
    if (activeIndex > 1 && watched && element && container) {
      prependAnchor.current = {
        id: watched.id,
        offset: element.offsetTop - container.offsetTop - container.scrollTop,
      };
    }
    prependPostsToFeedCache(queryClient, queryKey, newGusts);
    clearNewItems();
    showExternalNewItems();
    const prepended = new Map(newGusts.map((post) => [post.id, post]));
    setReel((current) => ({
      ...current,
      // Keep the clip being watched first in its new slot so the offset stays
      // valid, then let the merge place the new clips ahead of it.
      posts: [
        ...newGusts,
        ...current.posts.filter((post) => !prepended.has(post.id)),
      ],
    }));
    if (activeIndex <= 1) {
      setActiveIndex(0);
      containerRef.current?.scrollTo({ behavior: "smooth", top: 0 });
    } else {
      // The reader is deep in the reel: keep their position, the new clips are
      // reachable by swiping up rather than yanking them out of the feed.
      const nextPosts = [
        ...newGusts,
        ...posts.filter((post) => !prepended.has(post.id)),
      ];
      setActiveIndex(
        Math.max(
          0,
          nextPosts.findIndex((post) => post.id === watched?.id)
        )
      );
    }
  }, [
    activeIndex,
    clearNewItems,
    newGusts,
    posts,
    queryClient,
    queryKey,
    showExternalNewItems,
  ]);

  // Kept in sync so the wheel/touch listeners (attached once) can consult the
  // current value without re-binding on every fetch state change.
  const hasNextPageRef = useRef(hasNextPage);
  useEffect(() => {
    hasNextPageRef.current = hasNextPage;
  }, [hasNextPage]);

  // Scrolls the stream so the gust at `idx` is in view, computing the target
  // directly on the scroll container.
  const scrollToItem = useCallback((idx: number) => {
    const container = containerRef.current;
    const el = itemRefs.current[idx];
    if (!container || !el) {
      return;
    }
    const target = el.offsetTop - container.offsetTop;
    container.scrollTo({ behavior: "smooth", top: target });
  }, []);

  // Touch handling: pull-to-refresh from the top. Swiping past the last gust
  // needs no handling here - the doubled stream's scroll listener wraps it
  // back to the first copy seamlessly.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = touchStartYRef.current;
      if (startY === null || isRefreshing) {
        return;
      }
      const delta = (event.touches[0]?.clientY ?? startY) - startY;
      if (delta > 0 && container.scrollTop <= 0) {
        // Pull the indicator down with a little resistance.
        setPullDistance(Math.min(delta * 0.45, 96));
      }
    };

    const handleTouchEnd = () => {
      touchStartYRef.current = null;
      if (pullDistance >= 56) {
        void refreshFeed();
      } else {
        setPullDistance(0);
      }
    };

    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
    // posts.length gates this: the scroll container only exists once content
    // renders, and the effect must (re)attach after it mounts.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- posts.length intentionally re-runs this effect so the touch listeners attach once the scroll container mounts
  }, [isRefreshing, posts.length, pullDistance, refreshFeed]);

  // If ?id= was provided, jump straight to that gust once the feed is loaded:
  // mark it active (so its video plays) and center it in the stream container
  // instantly.
  const lastJumpedPostIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !initialPostId ||
      posts.length === 0 ||
      lastJumpedPostIdRef.current === initialPostId
    ) {
      return;
    }
    const idx = posts.findIndex((post) => post.id === initialPostId);
    if (idx === -1) {
      return;
    }
    lastJumpedPostIdRef.current = initialPostId;
    // Deferred to a microtask so the effect body never calls setState
    // synchronously while jumping to the ?id= gust.
    queueMicrotask(() => {
      setActiveIndex(idx);
    });
    const container = containerRef.current;
    const el = itemRefs.current[idx];
    if (container && el) {
      const target = el.offsetTop - container.offsetTop;
      container.scrollTo({ behavior: "smooth", top: Math.max(0, target) });
    }
  }, [initialPostId, posts]);

  // Set up IntersectionObserver to detect currently centered Reel
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!Number.isNaN(index)) {
              setActiveIndex(index);
            }
          }
        }
      },
      {
        root: containerRef.current,
        threshold: 0.6,
      }
    );

    for (const [index] of posts.entries()) {
      const el = itemRefs.current[index];
      if (el) {
        observer.observe(el);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [posts]);

  // Continue sparse pages while the reader is near the end, with one bounded read and backoff.
  useEffect(() => {
    if (
      loadedPageCount > 0 &&
      (isEndVisible || posts.length - activeIndex <= 8) &&
      canFetchNextPage &&
      !isFetchingNextPage
    ) {
      const timer = window.setTimeout(() => {
        void fetchNextPage();
      }, pagingDelay);
      return () => window.clearTimeout(timer);
    }
  }, [
    fetchNextPage,
    canFetchNextPage,
    isEndVisible,
    isFetchingNextPage,
    activeIndex,
    posts.length,
    pagingDelay,
    loadedPageCount,
  ]);

  // Keyboard navigation
  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      localStorage.setItem("gust-video-muted", String(next));
      return next;
    });
  }, []);

  const scrollToPrev = useCallback(() => {
    if (activeIndex > 0) {
      const prevIndex = activeIndex - 1;
      setActiveIndex(prevIndex);
      scrollToItem(prevIndex);
    }
  }, [activeIndex, scrollToItem]);

  const scrollToNext = useCallback(() => {
    if (activeIndex < posts.length - 1) {
      const nextIndex = activeIndex + 1;
      setActiveIndex(nextIndex);
      scrollToItem(nextIndex);
    }
  }, [activeIndex, posts.length, scrollToItem]);

  // Keyboard navigation for desktop: arrow down/up, j/k to jump between
  // gusts, m to toggle mute.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        isEditableTarget(e.target)
      ) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        scrollToNext();
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        scrollToPrev();
      } else if (e.key === "m") {
        e.preventDefault();
        handleToggleMute();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleMute, scrollToNext, scrollToPrev]);

  // Record a visit for the active gust so the recents card surfaces it and
  // keeps the "recently viewed" order fresh. Guests don't have history.
  const activePost = posts[activeIndex];
  useEffect(() => {
    if (!isLoggedIn || !activePost || activePost.external) {
      return;
    }
    const recordVisit = async () => {
      try {
        await kyInstance.post("/api/posts/visit", {
          json: { postId: activePost.id },
        });
        await queryClient.invalidateQueries({ queryKey: ["post-history"] });
      } catch {
        // Best-effort visit tracking; ignore failures
      }
    };
    void recordVisit();
  }, [activePost, isLoggedIn, queryClient]);

  const handleOpenUpload = useCallback(() => {
    if (!user) {
      goToLogin();
      return;
    }
    openComposer("gust");
  }, [goToLogin, openComposer, user]);

  // ?create=true opens the composer in gust mode on arrival.
  useEffect(() => {
    if (autoOpenCreate && user) {
      openComposer("gust");
    }
  }, [autoOpenCreate, openComposer, user]);

  const retrySources = [
    {
      handleRetry: () => {
        if (nativePageError) {
          void fetchNativeNextPage({ cancelRefetch: false });
        } else {
          void refetchNative();
        }
      },
      hasError: includeNative && nativeStatus === "error",
      isFetching: isFetchingNative,
      label: "ASM",
    },
    {
      handleRetry: () => {
        if (externalPageError) {
          void fetchExternalNextPage({ cancelRefetch: false });
        } else {
          void refetchExternal();
        }
      },
      hasError: includeExternal && externalFeed.isError,
      isFetching: externalFeed.isFetching,
      label: "Bluesky",
    },
  ];
  const renderContent = () => {
    if (!network.ready && network.isError) {
      return (
        <FeedErrorState
          message="We couldn’t load your feed preferences. Please try again."
          onRetry={() => {
            void network.refetch();
          }}
          isRetrying={network.isFetching}
        />
      );
    }
    // Checked before the loading branches: a disabled (gated) query stays
    // "pending" forever, which would otherwise render the skeleton.
    if (gatedPersonalized) {
      return (
        <div className="flex h-full w-full items-center justify-center p-6">
          <AuthPromptCard
            className="w-full max-w-md"
            description="Your Gusts feed learns from what you watch, amplify and bookmark."
            imageSize={128}
            title="Log in for Gusts made for you"
          />
        </div>
      );
    }

    if (
      (status === "error" && !canFetchNextPage) ||
      (posts.length === 0 && pageError && !canFetchNextPage)
    ) {
      return (
        <GustFeedErrorState
          onRetry={() => {
            void refetch();
          }}
          sources={retrySources}
        />
      );
    }

    if (status === "pending") {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <GustCardSkeleton />
        </div>
      );
    }

    // An empty-but-loading feed: the auto-fetch keeps pulling pages while more
    // exist (and the first page may simply not have had video gusts). Show the
    // skeleton instead of the "No Gusts yet" panel so the empty state only
    // appears once the feed is genuinely exhausted.
    if (posts.length === 0 && hasNextPage) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <GustCardSkeleton />
        </div>
      );
    }

    if (posts.length === 0) {
      const focused =
        gustTab !== "following" &&
        !initialPostId &&
        !externalId &&
        activeNetworkInterests(network.settings.preferences).length > 0;
      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
          <Image
            alt="No Gusts"
            className="mb-4 size-32 rounded-full object-contain opacity-80"
            draggable={false}
            height={128}
            src={noMediaImage}
            width={128}
          />
          <h2 className="text-foreground text-xl font-bold">
            {focused ? "No Gusts match this profile yet" : "No Gusts yet"}
          </h2>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            {focused
              ? "Try another profile or add interests in Network settings."
              : "Be the first to share a high-energy short-form video clip with the community!"}
          </p>

          <Button className="mt-5" onClick={handleOpenUpload} variant="premium">
            <Plus className="mr-1.5 size-4" />
            {focused ? "Create a Gust" : "Create the First Gust"}
          </Button>
        </div>
      );
    }

    return (
      <div className="flex h-full w-full max-w-6xl items-center justify-center gap-4 py-0 sm:px-2 sm:py-3 md:px-6">
        <div className="relative isolate h-full w-full max-w-4xl transition-[width] duration-300 ease-out">
          {/* Vertical Snap Stream */}
          <div
            className="hide-native-scrollbar h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-y-contain"
            style={{
              overflowY: isCommentsOpen && isMobile ? "hidden" : undefined,
            }}
            onScroll={(event) => {
              const previous = headerScroll.current;
              const next = advanceGustHeader(
                event.currentTarget.scrollTop,
                previous
              );
              headerScroll.current = next;
              if (previous.visible !== next.visible) {
                setHeaderVisible(next.visible);
              }
            }}
            ref={containerRef}
          >
            {streamSlots.map((slot, idx) => {
              const post = slot.id === null ? null : posts[idx];
              if (!post) {
                return (
                  <GustStreamSlot
                    pending
                    loading={isFetchingNextPage}
                    key={slot.key}
                  >
                    {pageError && !isFetchingNextPage ? (
                      <GustSourceRetries sources={retrySources} />
                    ) : (
                      <GustCardSkeleton />
                    )}
                  </GustStreamSlot>
                );
              }
              const isCurrentActive = activeIndex === idx;
              const distance = Math.abs(idx - activeIndex);
              const shouldMount = isCurrentActive || distance <= 2;

              return (
                <GustStreamSlot
                  index={idx}
                  key={slot.key}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                >
                  <RecommendationTracker
                    key={post.id}
                    exposureFeed={gustTab}
                    className="h-full w-full"
                    postId={post.id}
                    networkSource={post.external?.source}
                    networkToken={post.external?.networkRecommendationToken}
                    requestId={post.recommendation?.requestId}
                  >
                    <GustCard
                      commentsOpen={
                        isCommentsOpen && isMobile && isCurrentActive
                      }
                      interactive
                      isActive={isCurrentActive}
                      isMuted={isMuted}
                      onOpenComments={() => setIsCommentsOpen(true)}
                      onToggleMute={handleToggleMute}
                      onUnavailable={handleUnavailable}
                      post={post}
                      shouldMountVideo={shouldMount}
                    />
                  </RecommendationTracker>
                </GustStreamSlot>
              );
            })}

            {!hasNextPage && !isFetchingNextPage ? (
              <GustSourceRetries sources={retrySources} />
            ) : null}

            {/* Pagination sentinel: triggers the next page even when the feed
              is short, keeping the stream effectively infinite. */}
            {hasNextPage ? <div ref={endSentinelRef} /> : null}
          </div>
        </div>

        {isCommentsOpen && posts[activeIndex] ? (
          <div className="hidden h-full max-h-[calc(100dvh-5rem)] w-105 shrink-0 md:block">
            <div className="reels-panel flex h-full w-full flex-col overflow-hidden rounded-3xl">
              <GustsCommentsDrawer
                onClose={() => setIsCommentsOpen(false)}
                post={posts[activeIndex]}
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {/* Main Gusts Container */}
      <div className="relative flex min-w-0 flex-1 justify-center overflow-hidden bg-[hsl(var(--background-alt))]">
        <div
          aria-hidden={!headerShown}
          inert={!headerShown}
          data-gust-header
          className={cn(
            "absolute top-4 right-4 left-4 z-30 grid min-h-11 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-1 transition-[opacity,transform] duration-200 motion-reduce:transform-none md:top-3.5",
            !headerShown && "pointer-events-none -translate-y-4 opacity-0"
          )}
        >
          <button
            aria-label="Go back"
            className="icon-btn-3d flex size-10 items-center justify-center rounded-full md:size-9"
            onClick={() => router.back()}
            type="button"
          >
            <ChevronLeft className="size-5 md:size-4.5" />
          </button>
          <div className="flex min-w-0 items-center justify-center">
            {isLoggedIn ? (
              <GustFeedControls
                active={gustTab}
                avatars={followingAvatars}
                onChange={handleTabChange}
              />
            ) : (
              <div className="flex items-center gap-2">
                <GustTab
                  active={gustTab === "latest"}
                  label="Latest"
                  onClick={() => handleTabChange("latest")}
                />
                <GustTab
                  active={gustTab === "personalized"}
                  label="For you"
                  onClick={() => handleTabChange("personalized")}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-center">
            <FeedSourceMenu following={gustTab === "following"} />
          </div>
        </div>

        {renderContent()}

        {/* Pull-to-refresh indicator (mobile) */}
        <motion.div
          animate={{
            height: isRefreshing ? 64 : pullDistance,
            opacity: pullDistance > 0 || isRefreshing ? 1 : 0,
          }}
          className="absolute top-20 right-0 left-0 z-20 flex items-start justify-center overflow-hidden"
        >
          <div className="rail-3d-btn mt-1 flex h-10 w-10 items-center justify-center rounded-full">
            <Spinner3D className="size-5" />
          </div>
        </motion.div>

        {/* New gust pill */}
        <AnimatePresence>
          {gustTab === "following" &&
          allNewGusts.length > 0 &&
          !(isCommentsOpen && isMobile) ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="pointer-events-none absolute top-20 left-1/2 z-30 -translate-x-1/2"
              exit={{ opacity: 0 }}
              initial={false}
              transition={reducedMotion ? { duration: 0 } : undefined}
            >
              <NewContentPill
                authors={[
                  ...new Map<string, NewContentAuthor>(
                    allNewGusts.map((post) => [
                      post.userId,
                      {
                        avatarUrl: post.user?.avatarUrl,
                        id: post.userId,
                        username: post.user?.username,
                      },
                    ])
                  ).values(),
                ]}
                count={allNewGusts.length}
                noun="gust"
                onClick={showNewGusts}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {status === "success" && posts.length > 0 ? (
          <div className="fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 flex-col items-center gap-3 md:flex">
            <button
              aria-label="Previous Gust"
              className="rail-3d-btn flex h-11 w-11 cursor-pointer items-center justify-center rounded-full shadow-md transition-all duration-150 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
              disabled={activeIndex <= 0}
              onClick={scrollToPrev}
              type="button"
            >
              <ChevronUp className="size-5" />
            </button>
            <button
              aria-label="Next Gust"
              className="rail-3d-btn flex h-11 w-11 cursor-pointer items-center justify-center rounded-full shadow-md transition-all duration-150 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
              disabled={activeIndex >= posts.length - 1}
              onClick={scrollToNext}
              type="button"
            >
              <ChevronDown className="size-5" />
            </button>
          </div>
        ) : null}

        {posts[activeIndex] ? (
          <MobileGustEddies
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
            onClose={() => setIsCommentsOpen(false)}
            open={isCommentsOpen}
            post={posts[activeIndex]}
          />
        ) : null}
      </div>
    </>
  );
};
