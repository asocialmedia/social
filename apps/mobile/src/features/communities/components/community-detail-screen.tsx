import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, CalendarDays, Flame, Users } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { ExplorePostCard } from "@/features/explore/components/explore-post-card";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import {
  CommunityApiError,
  fetchCommunityDetail,
  fetchCommunityPosts,
} from "../lib/communities-api";
import type { CommunityDetail } from "../lib/communities-api";
import { useCommunityMembership } from "../state/use-community-membership";
import { CommunityAvatar } from "./community-avatar";
import { CommunityJoinButton } from "./community-join-button";
import { CommunityMatureGate } from "./community-mature-gate";
import { CommunityNotifyButton } from "./community-notify-button";
import { CommunityRosterCard } from "./community-roster-card";

// Inferred from the API's own signature so the screen can never drift from the
// sorts the endpoint accepts, and so no type import is needed alongside the
// value import from the same module.
type CommunitySort = NonNullable<Parameters<typeof fetchCommunityPosts>[3]>;

export function CommunityDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { theme } = useAppTheme();
  const { user } = useSessionContext();
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"error" | "loading" | "success">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  // Web's community feed sorts New or Top; native was pinned to New.
  const [sort, setSort] = useState<CommunitySort>("new");
  // The 18+ confirmation is per community and per session, so it is not
  // remembered across launches: the gate is shown every time until confirmed.
  const [matureConfirmed, setMatureConfirmed] = useState(false);

  const load = useCallback(
    async (cursor: string | null) => {
      if (!slug) {
        return;
      }
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      if (cursor === null) {
        const [nextDetail, nextPosts] = await Promise.all([
          fetchCommunityDetail(slug, options),
          fetchCommunityPosts(slug, null, options, sort),
        ]);
        setDetail(nextDetail);
        setPosts(nextPosts.posts);
        setNextCursor(nextPosts.nextCursor);
        setStatus("success");
        setError(null);
        return;
      }
      const nextPosts = await fetchCommunityPosts(slug, cursor, options, sort);
      setPosts((current) => [
        ...current,
        ...nextPosts.posts.filter(
          (post) => !current.some((item) => item.id === post.id)
        ),
      ]);
      setNextCursor(nextPosts.nextCursor);
      setStatus("success");
      setError(null);
    },
    [slug, sort]
  );

  useEffect(() => {
    if (!slug) {
      return;
    }
    let active = true;
    void (async () => {
      await authClient.getCookie();
      if (!active) {
        return;
      }
      setStatus("loading");
      setError(null);
      try {
        await load(null);
      } catch (caughtError) {
        if (active) {
          setError(
            caughtError instanceof CommunityApiError
              ? caughtError.message
              : "Couldn't load community"
          );
          setStatus("error");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [load, slug]);

  const retry = useCallback(async () => {
    if (!slug) {
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      await load(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof CommunityApiError
          ? caughtError.message
          : "Couldn't load community"
      );
      setStatus("error");
    }
  }, [load, slug]);

  // Declared before the early returns so hook order stays stable while the
  // detail is still loading; the state settles on its own once the slug is
  // known and the first membership read lands.
  const membershipState = useCommunityMembership({
    initialMembership: detail?.membership ?? null,
    isLoggedIn: Boolean(user),
    slug: slug ?? "",
  });

  const requireLogin = useCallback(() => {
    router.push("/(auth)/login");
  }, [router]);

  // Web records the visit from its server-rendered page, which native has no
  // equivalent of, so the weekly-visitor count is pinged from the client on
  // open. Best effort: a failed ping must never block the screen.
  useEffect(() => {
    if (!slug || !user) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const cookie = await authClient.getCookie();
        if (!active) {
          return;
        }
        await fetch(
          `${getApiBaseUrl()}/api/communities/${encodeURIComponent(slug)}/visit`,
          { headers: { cookie }, method: "POST" }
        );
      } catch {
        // Ignored on purpose.
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, user]);

  if (!slug) {
    return (
      <View style={[styles.center, { backgroundColor: theme.containerBg }]}>
        <Text style={{ color: theme.inputText }}>Community not found</Text>
        <Pressable onPress={() => router.back()} style={styles.retry}>
          <Text style={styles.retryText}>Go back</Text>
        </Pressable>
      </View>
    );
  }
  if (status === "loading" || !detail) {
    return (
      <View style={[styles.center, { backgroundColor: theme.containerBg }]}>
        <ActivityIndicator color="#f97316" />
      </View>
    );
  }
  if (status === "error") {
    return (
      <View style={[styles.center, { backgroundColor: theme.containerBg }]}>
        <Text style={{ color: theme.inputText }}>{error}</Text>
        <Pressable onPress={retry} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const { community } = detail;
  const banner = community.bannerUrl
    ? `${getApiBaseUrl()}${community.bannerUrl}`
    : null;
  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <FlatList
        contentContainerStyle={styles.content}
        data={posts}
        keyExtractor={(post) => post.id}
        ListHeaderComponent={
          <View>
            <View style={styles.topBar}>
              <Pressable
                accessibilityLabel="Go back"
                accessibilityRole="button"
                onPress={() => router.back()}
                style={styles.topButton}
              >
                <ArrowLeft color={theme.inputText} size={21} />
              </Pressable>
              <Text
                numberOfLines={1}
                style={[styles.topTitle, { color: theme.inputText }]}
              >
                {community.name}
              </Text>
              <View style={styles.topButton} />
            </View>
            <View
              style={[
                styles.banner,
                { backgroundColor: `${community.accentColor ?? "#f97316"}33` },
              ]}
            >
              {banner ? (
                <Image
                  contentFit="cover"
                  source={{ uri: banner }}
                  style={styles.bannerImage}
                />
              ) : null}
            </View>
            <View style={styles.header}>
              <View style={styles.avatar}>
                <CommunityAvatar community={community} size={64} />
              </View>
              <Text style={[styles.name, { color: theme.inputText }]}>
                {community.name}
              </Text>
              <Text style={[styles.slug, { color: theme.dividerText }]}>
                a/{community.slug}
              </Text>
              {community.description ? (
                <Text
                  style={[styles.description, { color: theme.dividerText }]}
                >
                  {community.description}
                </Text>
              ) : null}
              <View
                style={[
                  styles.stats,
                  {
                    backgroundColor: theme.cardBg,
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                <Stat
                  icon={<Flame color="#ff9500" fill="#ff9500" size={15} />}
                  label="Aura"
                  value={detail.stats.communityAura}
                />
                <Stat
                  icon={<Users color="#f97316" fill="#f97316" size={15} />}
                  label="Members"
                  value={detail.stats.members}
                />
                <Stat
                  icon={<CalendarDays color="#f97316" size={15} />}
                  label="Visitors"
                  value={detail.stats.weeklyVisitors}
                />
              </View>
              <View style={styles.sortTabs}>
                {(["new", "top"] as const).map((option) => {
                  const selected = option === sort;
                  return (
                    <Pressable
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      key={option}
                      onPress={() => {
                        if (option === sort) {
                          return;
                        }
                        setSort(option);
                        setStatus("loading");
                      }}
                      style={styles.sortTab}
                    >
                      <Text
                        style={[
                          styles.sortText,
                          { color: selected ? "#ff9500" : theme.dividerText },
                        ]}
                      >
                        {option === "new" ? "New" : "Top"}
                      </Text>
                      {selected ? <View style={styles.sortUnderline} /> : null}
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.actions}>
                <CommunityJoinButton
                  isLoggedIn={Boolean(user)}
                  membershipState={membershipState}
                  onRequireLogin={requireLogin}
                  style={styles.joinButton}
                />
                <CommunityNotifyButton
                  isLoggedIn={Boolean(user)}
                  membershipState={membershipState}
                  onRequireLogin={requireLogin}
                />
              </View>
            </View>
            <CommunityRosterCard
              canModerate={membershipState.canModerate}
              onRequireLogin={requireLogin}
              slug={community.slug}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.dividerText }]}>
            No posts in this community yet.
          </Text>
        }
        onEndReached={() => {
          if (nextCursor) {
            void load(nextCursor);
          }
        }}
        onEndReachedThreshold={0.6}
        renderItem={({ item }) => (
          <ExplorePostCard
            onPress={() =>
              router.push({
                params: { postId: item.id },
                pathname: "/posts/[postId]",
              })
            }
            onRequireLogin={() => router.push("/(auth)/login")}
            post={item}
            viewerLoggedIn={Boolean(user)}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      {community.mature && !matureConfirmed ? (
        <CommunityMatureGate
          community={community}
          onEnter={() => {
            setMatureConfirmed(true);
          }}
          onLeave={() => {
            router.back();
          }}
        />
      ) : null}
    </View>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={[styles.statValue, { color: theme.inputText }]}>
        {value.toLocaleString()}
      </Text>
      <Text style={[styles.statLabel, { color: theme.dividerText }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  avatar: { marginTop: -32 },
  banner: { height: 150, overflow: "hidden" },
  bannerImage: { height: "100%", width: "100%" },
  center: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    padding: 24,
  },
  content: { paddingBottom: 40 },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  empty: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    padding: 32,
    textAlign: "center",
  },
  header: { paddingHorizontal: 16, paddingTop: 0 },
  joinButton: { flex: 1 },
  name: { fontFamily: "SofiaProBold", fontSize: 25, marginTop: 12 },
  retry: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 13 },
  root: { flex: 1 },
  slug: { fontFamily: "SofiaProReg", fontSize: 14, marginTop: 2 },
  sortTab: { alignItems: "flex-start", paddingVertical: 8 },
  sortTabs: { flexDirection: "row", gap: 18, marginTop: 14 },
  sortText: { fontFamily: "SofiaProMed", fontSize: 14 },
  sortUnderline: {
    backgroundColor: "#ff9500",
    borderRadius: 2,
    height: 2,
    marginTop: 3,
    width: "100%",
  },
  stat: { alignItems: "center", gap: 3 },
  statLabel: { fontFamily: "SofiaProReg", fontSize: 10 },
  statValue: { fontFamily: "SofiaProBold", fontSize: 15, marginTop: 2 },
  stats: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 18,
    paddingVertical: 14,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    height: 52,
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  topButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  topTitle: { fontFamily: "SofiaProBold", fontSize: 16, maxWidth: 240 },
});
