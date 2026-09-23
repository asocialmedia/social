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
// - floating bottom nav + guest bar, like HomeScreen
//
// Deltas vs web (documented, REST-only): no PostAuthorSidebar (desktop
// only), no ?comment= deep scroll (PostComments has no id anchors yet),
// no swipe-to-profile (profile screens don't exist yet), Respond stays a
// static count (composer doesn't exist yet), and the more menu is the v1
// local variant (toggle ALT when describable, else share) until MoreMenu's
// in-flight API migration settles - FeedList currently calls the old
// (post/showingAlt) signature while more-menu.tsx exports the new
// (anchor/entries) one, so this screen deliberately does not import it.
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import errorImage from "@/assets/images/error.png";
import notFoundImage from "@/assets/images/notfound.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { FloatingEddieBar } from "@/features/eddies/components/floating-eddie-bar";
import { PostCard } from "@/features/feed/components/post-card";
import { PostComments } from "@/features/feed/components/post-comments";
import { ShareSheet } from "@/features/feed/components/share-sheet";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { normalizePostData } from "@/features/feed/lib/feed-types";
import { viewBatcher } from "@/features/feed/lib/view-batcher";
import { GuestAuthBar } from "@/features/home/components/guest-auth-bar";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
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

type DetailStatus =
  | "error"
  | "loading"
  | "not-found"
  | "ready"
  | "unauthorized";

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
  const [guestBarHeight, setGuestBarHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // v1 more action (see header comment): toggle ALT when the post carries a
  // described attachment, otherwise fall through to share. Full menu lands
  // once MoreMenu's migration settles.
  const handleMore = useCallback((target: FeedPost) => {
    const describable = (target.attachments ?? []).some(
      (media) => media?.altText
    );
    if (describable) {
      setAltVisibleIds((current) => {
        const next = new Set(current);
        if (next.has(target.id)) {
          next.delete(target.id);
        } else {
          next.add(target.id);
        }
        return next;
      });
      return;
    }
    setSharePost(target);
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
              setRelated(rows);
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
        if (code === 401) {
          setStatus("unauthorized");
        } else if (code === 404) {
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
        <MobileBottomNav bottomOffset={showGuestBar ? guestBarHeight : 0} />
      </View>
    );
  }

  if (status === "unauthorized") {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={handleGoBack}
            style={styles.backBtn}
          >
            <ArrowLeft color={theme.inputText} size={20} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.inputText }]}>
            Post
          </Text>
        </View>
        <View style={styles.centerWrap}>
          <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
            Log in to see this post
          </Text>
          <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
            Post detail needs a signed-in session on mobile for now.
          </Text>
          <Pressable
            onPress={() => router.push("/(auth)/login")}
            style={styles.loginBtn}
          >
            <Text style={styles.loginText}>Log in</Text>
          </Pressable>
        </View>
        {showGuestBar ? (
          <View
            onLayout={(event) => {
              setGuestBarHeight(event.nativeEvent.layout.height);
            }}
          >
            <GuestAuthBar />
          </View>
        ) : null}
        <MobileBottomNav bottomOffset={showGuestBar ? guestBarHeight : 0} />
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
            style={styles.backBtn}
          >
            <ArrowLeft color={theme.inputText} size={20} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.inputText }]}>
            Post
          </Text>
        </View>
        <View style={styles.centerWrap}>
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
          <View
            onLayout={(event) => {
              setGuestBarHeight(event.nativeEvent.layout.height);
            }}
          >
            <GuestAuthBar />
          </View>
        ) : null}
        <MobileBottomNav bottomOffset={showGuestBar ? guestBarHeight : 0} />
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
          style={styles.backBtn}
        >
          <ArrowLeft color={theme.inputText} size={20} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.inputText }]}>
          Post
        </Text>
      </View>
      <ScrollView
        onMomentumScrollEnd={(event) => {
          detailScrollMemory.set(
            `post:${postId}`,
            event.nativeEvent.contentOffset.y
          );
        }}
        ref={scrollRef}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {renderThread()}
        {showEddies ? (
          <PostComments postId={post.id} variant="page" viewerId={viewerId} />
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
        <View
          onLayout={(event) => {
            setGuestBarHeight(event.nativeEvent.layout.height);
          }}
        >
          <GuestAuthBar />
        </View>
      ) : null}
      <MobileBottomNav bottomOffset={showGuestBar ? guestBarHeight : 0} />
      {showEddies && viewerId ? <FloatingEddieBar postId={post.id} /> : null}
      <ShareSheet onClose={() => setSharePost(null)} post={sharePost} />
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
});
