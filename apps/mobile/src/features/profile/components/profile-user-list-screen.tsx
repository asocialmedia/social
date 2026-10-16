import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import noFollowImage from "@/assets/images/nofollow.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { fetchProfileUserList, useProfile } from "@/features/profile";
import type { ProfileListKind, ProfileUserListItem } from "@/features/profile";
import {
  SettingsButton,
  SettingsInput,
} from "@/features/settings/components/settings-ui";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { ResourceCache } from "@/lib/resource-cache";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { swipeTab } from "@/lib/tab-swipe";
import { useCachedResource } from "@/lib/use-cached-resource";
import { useTabSwipe } from "@/lib/use-tab-swipe";
import { useAppTheme } from "@/theme";

import { mutateFollow } from "../lib/profile-api";
import { UserListSkeleton } from "./user-list-skeleton";

const LIST_TABS = [
  { label: "Followers", value: "followers" },
  { label: "Following", value: "following" },
] as const;
const TAB_ORDER = ["followers", "following"] as const;
const listCache = new ResourceCache<ProfileUserListItem[]>({
  maxEntries: 40,
  staleMs: 60_000,
});

export function ProfileUserListScreen({
  kind: initialKind,
}: {
  kind: ProfileListKind;
}) {
  const params = useLocalSearchParams<{ username?: string; tab?: string }>();
  const username = typeof params.username === "string" ? params.username : "";
  const kind = params.tab === "following" ? "following" : initialKind;
  const router = useRouter();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { user: viewer, isPending } = useSessionContext();
  const { runWithInstallToken } = useInstall();
  const {
    profile,
    status: profileStatus,
    reload: reloadProfile,
  } = useProfile(username);
  const [query, setQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<FlatList<ProfileUserListItem>>(null);
  const scrollOffsets = useRef(new Map<string, number>());
  const apiBase = getApiBaseUrl();
  const scope =
    viewer && profile ? `${apiBase}:${viewer.id}:${profile.id}` : null;
  const loader = useCallback(
    async () =>
      fetchProfileUserList(profile?.id ?? "", kind, {
        apiBase,
        cookie: await authClient.getCookie(),
      }),
    [apiBase, kind, profile?.id]
  );
  const resource = useCachedResource(
    listCache,
    scope ? `${scope}:${kind}` : null,
    loader
  );
  useEffect(() => {
    if (!scope || !profile) {
      return;
    }
    const other = kind === "followers" ? "following" : "followers";
    void listCache.load(`${scope}:${other}`, async () =>
      fetchProfileUserList(profile.id, other, {
        apiBase,
        cookie: await authClient.getCookie(),
      })
    );
  }, [apiBase, kind, profile, scope]);
  useEffect(() => {
    listRef.current?.scrollToOffset({
      animated: false,
      offset: scrollOffsets.current.get(`${kind}:${query}`) ?? 0,
    });
  }, [kind, query]);
  const users = useMemo(() => {
    const search = query.trim().replace(/^@/, "").toLowerCase();
    return (resource.data ?? []).filter(
      (user) =>
        !search ||
        `${user.displayName ?? ""} ${user.username}`
          .toLowerCase()
          .includes(search)
    );
  }, [query, resource.data]);
  const selectTab = useCallback(
    (next: ProfileListKind) => {
      router.setParams({ tab: next });
    },
    [router]
  );
  const navigateTab = useCallback(
    (direction: -1 | 1) => selectTab(swipeTab(TAB_ORDER, kind, direction)),
    [kind, selectTab]
  );
  const swipe = useTabSwipe(navigateTab);
  const goBack = useCallback(
    () =>
      router.dismissTo({ params: { username }, pathname: "/users/[username]" }),
    [router, username]
  );
  const updateFollowing = useCallback(
    (id: string, following: boolean) => {
      if (!scope) {
        return;
      }
      for (const tab of TAB_ORDER) {
        const key = `${scope}:${tab}`;
        const { data } = listCache.read(key);
        if (data) {
          listCache.setData(
            key,
            data.map((user) =>
              user.id === id ? { ...user, isFollowing: following } : user
            )
          );
        }
      }
    },
    [scope]
  );
  const toggleFollow = async (
    item: ProfileUserListItem,
    event: GestureResponderEvent
  ) => {
    event.stopPropagation();
    if (!viewer || pendingIds.has(item.id)) {
      return;
    }
    const next = !item.isFollowing;
    setPendingIds((current) => new Set(current).add(item.id));
    updateFollowing(item.id, next);
    try {
      const result = await runWithInstallToken(
        async () =>
          mutateFollow(item.id, next, {
            apiBase,
            cookie: await authClient.getCookie(),
          }),
        (value) => value.kind === "install-token-required"
      );
      if (!result || result.kind !== "success") {
        updateFollowing(item.id, item.isFollowing);
        if (result?.kind === "error") {
          toast({
            description: result.message,
            title: "Couldn't update follow",
            variant: "destructive",
          });
        }
      } else {
        updateFollowing(item.id, result.isFollowedByUser);
      }
    } catch (error) {
      updateFollowing(item.id, item.isFollowing);
      toast({
        description: error instanceof Error ? error.message : "Try again.",
        title: "Couldn't update follow",
        variant: "destructive",
      });
    }
    setPendingIds(
      (current) => new Set([...current].filter((id) => id !== item.id))
    );
  };
  const loading =
    isPending ||
    profileStatus === "loading" ||
    (profileStatus === "success" &&
      resource.data === null &&
      resource.status !== "error");
  const error =
    profileStatus === "error" ? "Couldn't load this profile." : resource.error;
  const emptyTitle = query.trim()
    ? "No matching people"
    : { followers: "No followers yet", following: "Not following anyone yet" }[
        kind
      ];
  const emptyMessage = query.trim()
    ? "Try another name or username."
    : {
        followers: "People who follow this profile will show up here.",
        following: "People this profile follows will show up here.",
      }[kind];
  let empty: React.ReactNode;
  if (loading) {
    empty = <UserListSkeleton />;
  } else if (error) {
    empty = (
      <View style={styles.empty}>
        <Text style={[styles.title, { color: theme.inputText }]}>{error}</Text>
        <SettingsButton
          label="Try again"
          tone="gray"
          onPress={() => {
            if (profile) {
              void resource.reload();
            } else {
              reloadProfile();
            }
          }}
        />
      </View>
    );
  } else {
    empty = (
      <View style={styles.empty}>
        <Image
          source={noFollowImage}
          contentFit="contain"
          style={{ height: 160, width: 240 }}
        />
        <Text style={[styles.title, { color: theme.inputText }]}>
          {emptyTitle}
        </Text>
        <Text style={[styles.copy, { color: theme.dividerText }]}>
          {emptyMessage}
        </Text>
      </View>
    );
  }
  if (!viewer && !isPending) {
    empty = (
      <View style={styles.empty}>
        <Text style={[styles.title, { color: theme.inputText }]}>
          Log in to see this list
        </Text>
        <SettingsButton
          label="Log in"
          onPress={() => router.push("/(auth)/login")}
        />
      </View>
    );
  }
  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        hideOnScroll={false}
        onBack={goBack}
        user={viewer ? { ...viewer, username: viewer.username ?? "" } : null}
      />
      <FeedTabs
        active={kind}
        onChange={selectTab}
        tabs={LIST_TABS}
        alignment="center"
      />
      <View style={styles.search}>
        <SettingsInput
          hideLabel
          label="Search followers and following"
          leadingIcon={Search}
          placeholder="Search by name or username…"
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <GestureDetector gesture={swipe}>
        <View style={styles.root}>
          <FlatList
            ref={listRef}
            onScroll={(event) =>
              scrollOffsets.current.set(
                `${kind}:${query}`,
                event.nativeEvent.contentOffset.y
              )
            }
            scrollEventThrottle={16}
            {...LIST_VIRTUALIZATION_PROPS}
            data={users}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={empty}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
            renderItem={({ item }) => (
              <Pressable
                accessibilityLabel={`Open @${item.username}'s profile`}
                accessibilityRole="link"
                onPress={() =>
                  router.push({
                    params: { username: item.username },
                    pathname: "/users/[username]",
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed
                      ? theme.passkeyBg
                      : theme.containerBg,
                    borderBottomColor: theme.cardBorder,
                  },
                ]}
              >
                <UserAvatar
                  size={44}
                  url={item.avatarUrl}
                  username={item.username}
                  userId={item.id}
                />
                <View style={styles.rowCopy}>
                  <Text
                    style={[styles.name, { color: theme.inputText }]}
                    numberOfLines={1}
                  >
                    {item.displayName || item.username}
                  </Text>
                  <Text
                    style={[styles.handle, { color: theme.dividerText }]}
                    numberOfLines={1}
                  >
                    @{item.username}
                  </Text>
                  {item.mutualCount > 0 ? (
                    <View style={styles.mutuals}>
                      <View style={styles.avatars}>
                        {item.mutualFollowers.map((mutual, index) => (
                          <View
                            key={mutual.id}
                            style={{
                              borderColor: theme.containerBg,
                              borderRadius: 20,
                              borderWidth: 2,
                              marginLeft: index ? -6 : 0,
                            }}
                          >
                            <UserAvatar
                              size={18}
                              radius={9}
                              url={mutual.avatarUrl}
                              username={mutual.username}
                              userId={mutual.id}
                            />
                          </View>
                        ))}
                      </View>
                      <Text
                        style={[
                          styles.mutualText,
                          { color: theme.dividerText },
                        ]}
                        numberOfLines={1}
                      >
                        {item.mutualCount}{" "}
                        {item.mutualCount === 1 ? "mutual" : "mutuals"}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {viewer && item.id !== viewer.id ? (
                  <SettingsButton
                    disabled={pendingIds.has(item.id)}
                    loading={pendingIds.has(item.id)}
                    size="sm"
                    tone={item.isFollowing ? "gray" : "primary"}
                    label={item.isFollowing ? "Following" : "Follow"}
                    onPress={(event) => {
                      void toggleFollow(item, event);
                    }}
                  />
                ) : null}
              </Pressable>
            )}
          />
        </View>
      </GestureDetector>
    </View>
  );
}
const styles = StyleSheet.create({
  avatars: { flexDirection: "row" },
  copy: { fontFamily: "SofiaProReg", fontSize: 13, textAlign: "center" },
  empty: { alignItems: "center", gap: 12, padding: 32, paddingVertical: 48 },
  handle: { fontFamily: "SofiaProReg", fontSize: 13 },
  mutualText: { fontFamily: "SofiaProReg", fontSize: 11 },
  mutuals: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 4 },
  name: { fontFamily: "SofiaProMed", fontSize: 15 },
  root: { flex: 1 },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowCopy: { flex: 1, gap: 2 },
  search: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: "SofiaProMed", fontSize: 15, textAlign: "center" },
});
