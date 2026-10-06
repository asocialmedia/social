// Post detail screen: native 1:1 of web's mobile ClientPost
// (app/(main)/posts/[postId]/client-post.tsx, mobile layout).
//
// Same column, top to bottom:
// - back + "Post" header row
// - ancestor thread (collapsed behind "Show X earlier replies" when >3,
//   dashed rail, root + direct parent + detail card)
// - detail card (expanded content, full media column, mobile action bar)
// - full eddies thread (PostComments, composer for signed-in viewers)
// - "View more content" + "View all posts" row + related rail
//
// No bottom nav here, unlike HomeScreen: the detail view is a focused read, and
// a dock under a thread invites the reader to wander off mid-argument. The guest
// auth bar is the only bottom overlay, flush with the edge.
//
// Deltas vs web: no PostAuthorSidebar, which is a desktop-only aside and has
// no place in a single column. Everything else this comment used to list as
// missing is not: the more menu is the shared MoreMenu, the composer exists,
// profile screens exist, and the thread carries id offsets for ?comment=.
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import errorImage from "@/assets/images/error.png";
import notFoundImage from "@/assets/images/notfound.png";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { FloatingEddieBar } from "@/features/eddies/components/floating-eddie-bar";
import {
  buildMoreEntries,
  MoreMenu,
} from "@/features/feed/components/more-menu";
import type { MenuAnchor } from "@/features/feed/components/more-menu";
import { PostCard } from "@/features/feed/components/post-card";
import { PostComments } from "@/features/feed/components/post-comments";
import { ShareSheet } from "@/features/feed/components/share-sheet";
import { usePostOverflow } from "@/features/feed/components/use-post-overflow";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { normalizePostData } from "@/features/feed/lib/feed-types";
import { viewBatcher } from "@/features/feed/lib/view-batcher";
import { GuestAuthBar } from "@/features/home/components/guest-auth-bar";
import { getApiBaseUrl } from "@/lib/api-env";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { logInfo, logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import {
  fetchPostDetail,
  fetchRelatedPosts,
  recordPostVisit,
} from "../lib/post-api";
import { PostDetailCard } from "./post-detail-card";
import { PostDetailSkeleton } from "./post-detail-skeleton";

// Scroll offsets survive detail detours like web's useFeedScrollMemory with
// memoryKey `post:<id>`. Module scope: one entry per post id.
const detailScrollMemory = new Map<string, number>();

type DetailStatus = "error" | "loading" | "not-found" | "ready";

export function PostDetailScreen({ postId }: { postId: string }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPending, user } = useSessionContext();
  const viewerId = user?.id;
  const showGuestBar = !isPending && !user;

  const [status, setStatus] = useState<DetailStatus>("loading");
  const [post, setPost] = useState<FeedPost | null>(null);
  const [ancestors, setAncestors] = useState<FeedPost[]>([]);
  const [related, setRelated] = useState<FeedPost[]>([]);
  const [ancestorsExpanded, setAncestorsExpanded] = useState(false);
  const [showEddies, setShowEddies] = useState(true);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [altVisibleIds, setAltVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  // The bottom dock is deliberately absent on this screen: the post detail is a
  // focused read, and a navigation bar under a thread invites the reader to
  // wander off mid-argument. Web's mobile post page does the same. The guest
  // auth bar therefore sits flat on the bottom edge with no dock to clear.
  const [bannerHeight, setBannerHeight] = useState(0);
  const feedBottomPad = showGuestBar ? bannerHeight + insets.bottom + 12 : 0;
  const scrollRef = useRef<ScrollView>(null);
  // Web's ?comment= deep scroll: the thread reports where the eddie sits
  // inside itself, and the thread's own offset inside this scroll view turns
  // that into a scroll position. Both are measured, never guessed, so a
  // missing or paged-out eddie lands nowhere rather than at a wrong place.
  const params = useLocalSearchParams<{ comment?: string | string[] }>();
  const commentParam = Array.isArray(params.comment)
    ? (params.comment[0] ?? null)
    : (params.comment ?? null);
  const threadY = useRef(0);
  const scrolledTo = useRef<string | null>(null);
  const handleThreadLayout = useCallback((event: LayoutChangeEvent) => {
    threadY.current = event.nativeEvent.layout.y;
  }, []);
  const handleCommentOffset = useCallback(
    (commentId: string, yInThread: number) => {
      if (scrolledTo.current === commentId) {
        return;
      }
      scrolledTo.current = commentId;
      // A little air above the row so its header is not flush with the
      // screen edge once it arrives.
      scrollRef.current?.scrollTo({
        animated: true,
        y: threadY.current + yInThread - 24,
      });
      logInfo("post_detail.comment_deep_scroll", { commentId });
    },
    []
  );

  // The shared overflow menu, the same one the feed uses. This screen used to
  // carry a local variant that could only toggle ALT or fall through to share,
  // which is why moderation, delete and edit tags were unreachable from a post
  // page even though the routes existed.
  const overflow = usePostOverflow({
    onDeleted: () => {
      // The post is gone, so the page has nothing left to show.
      router.back();
    },
    onHide: () => {
      toast({
        description: "This post won't appear in your feed.",
        title: "Post hidden",
      });
    },
    onModerated: (mutatedId, next) => {
      setPost((current) =>
        current && current.id === mutatedId ? { ...current, ...next } : current
      );
    },
    onTagsSaved: () => {
      toast({
        description: "Tags updated",
        title: "Saved",
      });
    },
    onToggleAlt: (target) => {
      setAltVisibleIds((current) => {
        const next = new Set(current);
        if (next.has(target.id)) {
          next.delete(target.id);
        } else {
          next.add(target.id);
        }
        return next;
      });
    },
    viewerId: viewerId ?? null,
  });

  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);

  const handleMore = useCallback((target: FeedPost, anchor: MenuAnchor) => {
    setMenuAnchor(anchor);
    setMenuPost(target);
  }, []);

  const handleShare = useCallback((target: FeedPost) => {
    setSharePost(target);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- detail reload enters loading here; steady state is fetch-driven
    setStatus("loading");
    // oxlint-disable-next-line react/set-state-in-effect -- a new post resets the collapsed thread; steady state is user-driven
    setAncestorsExpanded(false);
    // oxlint-disable-next-line react/set-state-in-effect -- a new post re-opens eddies; steady state is user-driven
    setShowEddies(true);
    void (async () => {
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        const detail = await fetchPostDetail(postId, { apiBase, cookie });
        if (cancelled) {
          return;
        }
        setPost(detail.post);
        setAncestors(detail.ancestors.map(normalizePostData));
        setStatus("ready");
        // Related rail resolves against the full id (the /related route has
        // no short-prefix fallback, unlike the detail route).
        void (async () => {
          try {
            const rows = await fetchRelatedPosts(detail.post.id, {
              apiBase,
              cookie,
            });
            if (!cancelled && rows.length > 0) {
              setRelated(rows.filter((row) => !row.isGust));
            }
          } catch (error) {
            logWarn("post.related_failed", {
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        })();
        // Visit + view, logged-in only (guests have no visit history).
        if (viewerId) {
          void recordPostVisit(detail.post.id, { apiBase, cookie });
          viewBatcher.mark(detail.post.id, { apiBase, cookie });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const code =
          error && typeof error === "object" && "status" in error
            ? Number((error as { status: unknown }).status)
            : 0;
        if (code === 404) {
          setStatus("not-found");
        } else {
          setStatus("error");
        }
        logWarn("post.detail_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // postId + viewer identity key the load; viewerId is read for visit
    // gating only (a guest-to-user upgrade refetches with identity).
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- intentional detail load keyed by post
  }, [postId, viewerId]);

  // Restore the exact scroll position when returning from the fullscreen
  // media viewer, instead of landing back at the top.
  useEffect(() => {
    if (status !== "ready") {
      return;
    }
    const offset = detailScrollMemory.get(`post:${postId}`) ?? 0;
    if (offset > 0) {
      const timer = setTimeout(() => {
        scrollRef.current?.scrollTo({ animated: false, y: offset });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [postId, status]);

  const handleGoBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }, [router]);

  const thread = useMemo(() => {
    if (ancestors.length === 0 || !post) {
      return { kind: "none" } as const;
    }
    if (ancestors.length > 3 && !ancestorsExpanded) {
      const [rootAncestor] = ancestors;
      const directParent = ancestors.at(-1);
      if (!rootAncestor || !directParent) {
        return { kind: "none" } as const;
      }
      return {
        directParent,
        hiddenCount: ancestors.length - 2,
        kind: "collapsed",
        rootAncestor,
      } as const;
    }
    return { kind: "full" } as const;
  }, [ancestors, ancestorsExpanded, post]);

  const renderThread = () => {
    if (!post) {
      return null;
    }
    if (thread.kind === "none") {
      return (
        <PostDetailCard
          onMore={handleMore}
          onShare={handleShare}
          post={post}
          showAlt={altVisibleIds.has(post.id)}
          viewerId={viewerId}
          onToggleEddies={() => setShowEddies((value) => !value)}
          onOpenMedia={(index) =>
            router.push({
              params: { index: String(index), postId },
              pathname: "/posts/[postId]/media/[index]",
            })
          }
        />
      );
    }
    if (thread.kind === "collapsed") {
      return (
        <>
          <PostCard
            hasThreadChild
            hasThreadParent={false}
            onMore={handleMore}
            onShare={handleShare}
            post={thread.rootAncestor}
            showAlt={altVisibleIds.has(thread.rootAncestor.id)}
            viewerId={viewerId}
          />
          <View style={styles.collapsedRow}>
            <View style={styles.collapsedRail}>
              <View
                style={[
                  styles.collapsedDash,
                  { borderColor: theme.cardBorder },
                ]}
              />
            </View>
            <Pressable
              accessibilityLabel={`Show ${thread.hiddenCount} earlier replies`}
              accessibilityRole="button"
              onPress={() => setAncestorsExpanded(true)}
            >
              <Text style={[styles.collapsedLabel, { color: "#ff9500" }]}>
                Show {thread.hiddenCount} earlier{" "}
                {thread.hiddenCount === 1 ? "reply" : "replies"}
              </Text>
            </Pressable>
          </View>
          <PostCard
            hasThreadChild
            hasThreadParent
            onMore={handleMore}
            onShare={handleShare}
            post={thread.directParent}
            showAlt={altVisibleIds.has(thread.directParent.id)}
            viewerId={viewerId}
          />
          <PostDetailCard
            onMore={handleMore}
            onShare={handleShare}
            post={post}
            showAlt={altVisibleIds.has(post.id)}
            viewerId={viewerId}
            hasThreadParent
            joined
            onToggleEddies={() => setShowEddies((value) => !value)}
            onOpenMedia={(index) =>
              router.push({
                params: { index: String(index), postId },
                pathname: "/posts/[postId]/media/[index]",
              })
            }
          />
        </>
      );
    }
    return (
      <>
        {ancestors.map((ancestor, index) => (
          <PostCard
            hasThreadChild
            hasThreadParent={index > 0}
            key={ancestor.id}
            onMore={handleMore}
            onShare={handleShare}
            post={ancestor}
            showAlt={altVisibleIds.has(ancestor.id)}
            viewerId={viewerId}
          />
        ))}
        <PostDetailCard
          onMore={handleMore}
          onShare={handleShare}
          post={post}
          showAlt={altVisibleIds.has(post.id)}
          viewerId={viewerId}
          hasThreadParent
          joined
          onToggleEddies={() => setShowEddies((value) => !value)}
          onOpenMedia={(index) =>
            router.push({
              params: { index: String(index), postId },
              pathname: "/posts/[postId]/media/[index]",
            })
          }
        />
      </>
    );
  };

  if (status === "loading") {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <PostDetailSkeleton />
      </View>
    );
  }

  if ((status === "not-found" || status === "error") && !post) {
    const missing = status === "not-found";
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={handleGoBack}
            style={({ pressed }) => [
              styles.backBtn,
              pressed && styles.backBtnPressed,
            ]}
          >
            <ArrowLeft color={theme.inputText} size={20} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.inputText }]}>
            Post
          </Text>
        </View>
        <View
          style={[
            styles.centerWrap,
            showGuestBar ? { paddingBottom: feedBottomPad } : null,
          ]}
        >
          <Image
            contentFit="contain"
            source={missing ? notFoundImage : errorImage}
            style={styles.emptyArt}
          />
          <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
            {missing ? "Post not found" : "Couldn't load this post"}
          </Text>
          <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
            {missing
              ? "It may have been deleted or the link is wrong."
              : "Check your connection and try again."}
          </Text>
        </View>
        {showGuestBar ? (
          <Animated.View
            onLayout={(event) => {
              setBannerHeight(event.nativeEvent.layout.height);
            }}
            pointerEvents="box-none"
            style={styles.guestBarAnchor}
          >
            <GuestAuthBar />
          </Animated.View>
        ) : null}
      </View>
    );
  }

  if (!post) {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <View style={styles.centerWrap}>
          <ActivityIndicator color="#ff9500" size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={handleGoBack}
          style={({ pressed }) => [
            styles.backBtn,
            pressed && styles.backBtnPressed,
          ]}
        >
          <ArrowLeft color={theme.inputText} size={20} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.inputText }]}>
          Post
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: feedBottomPad }}
        onMomentumScrollEnd={(event) => {
          detailScrollMemory.set(
            `post:${postId}`,
            event.nativeEvent.contentOffset.y
          );
        }}
        ref={scrollRef}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
      >
        {renderThread()}
        {showEddies ? (
          <View onLayout={handleThreadLayout} style={styles.threadWrap}>
            <PostComments
              onCommentOffset={handleCommentOffset}
              postId={post.id}
              scrollToCommentId={commentParam}
              variant="page"
              viewerId={viewerId}
            />
          </View>
        ) : null}
        <View style={styles.moreRow}>
          <Text style={[styles.moreTitle, { color: theme.inputText }]}>
            View more content
          </Text>
          <Pressable
            accessibilityLabel="View all posts on the global feed"
            accessibilityRole="link"
            onPress={() => router.replace("/")}
          >
            <Text style={styles.moreLink}>View all posts</Text>
          </Pressable>
        </View>
        {related.map((entry) => (
          <View
            key={entry.id}
            style={[styles.related, { borderTopColor: theme.cardBorder }]}
          >
            <PostCard
              hasThreadChild={false}
              hasThreadParent={false}
              onMore={handleMore}
              onShare={handleShare}
              post={entry}
              showAlt={altVisibleIds.has(entry.id)}
              showCommunityReason
              viewerId={viewerId}
            />
          </View>
        ))}
        <View style={styles.endPad} />
        {/* Room for the floating eddie bar so it never covers the tail. */}
        {showEddies && viewerId ? <View style={styles.eddieBarPad} /> : null}
      </ScrollView>
      {showGuestBar ? (
        <Animated.View
          onLayout={(event) => {
            setBannerHeight(event.nativeEvent.layout.height);
          }}
          pointerEvents="box-none"
          style={styles.guestBarAnchor}
        >
          <GuestAuthBar />
        </Animated.View>
      ) : null}
      {showEddies && viewerId ? <FloatingEddieBar postId={post.id} /> : null}
      <ShareSheet onClose={() => setSharePost(null)} post={sharePost} />
      <MoreMenu
        anchor={menuAnchor}
        entries={
          menuPost
            ? buildMoreEntries({
                post: menuPost,
                showCaptions: false,
                showingAlt: altVisibleIds.has(menuPost.id),
                viewerId,
              })
            : []
        }
        onAction={(action) => {
          const target = menuPost;
          setMenuAnchor(null);
          setMenuPost(null);
          if (target) {
            overflow.onAction(action, target);
          }
        }}
        onClose={() => {
          setMenuAnchor(null);
          setMenuPost(null);
        }}
      />
      {overflow.dialogs}
    </View>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    alignItems: "center",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  backBtnPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.94 }],
  },
  centerWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  collapsedDash: {
    borderLeftWidth: 2,
    borderStyle: "dashed",
    bottom: -12,
    left: "50%",
    marginLeft: -1,
    position: "absolute",
    top: -12,
  },
  collapsedLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
    fontWeight: "normal",
    paddingVertical: 4,
  },
  collapsedRail: {
    alignSelf: "stretch",
    position: "relative",
    width: 36,
  },
  collapsedRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  eddieBarPad: {
    height: 72,
  },
  emptyArt: {
    height: 160,
    width: "100%",
  },
  emptyBody: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
    marginTop: 8,
    textAlign: "center",
  },
  emptyTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
    marginTop: 12,
    textAlign: "center",
  },
  endPad: {
    height: 32,
  },
  // Flush with the bottom edge: this screen has no dock, so the guest bar is
  // the only thing floating over the thread.
  guestBarAnchor: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 60,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  headerTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 18,
    fontWeight: "normal",
  },
  loginBtn: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  loginText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  moreLink: {
    color: "#ff9500",
    flexShrink: 0,
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  moreRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  moreTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  related: {
    borderTopWidth: 1,
  },
  root: {
    flex: 1,
  },
  threadWrap: { width: "100%" },
});
