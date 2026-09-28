import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import type { GestureResponderEvent } from "react-native";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { Spinner3D } from "@/components/feedback/spinner-3d";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import type { FeedTabDef } from "@/features/feed/components/feed-tabs";
import { fetchProfileUserList, useProfile } from "@/features/profile";
import type { ProfileListKind, ProfileUserListItem } from "@/features/profile";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { useAppTheme } from "@/theme";

import { mutateFollow } from "../lib/profile-api";

const LIST_TABS = [
  { label: "Followers", value: "followers" },
  { label: "Following", value: "following" },
] as const satisfies readonly FeedTabDef<ProfileListKind>[];

interface ListState {
  error: string | null;
  items: ProfileUserListItem[];
  key: string;
  status: "error" | "loading" | "success";
}

function usernameParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : (value?.[0] ?? "");
}

function ListStateView({
  message,
  onRetry,
  title,
}: {
  message: string;
  onRetry?: () => void;
  title: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.stateView}>
      <Text style={[styles.stateTitle, { color: theme.inputText }]}>
        {title}
      </Text>
      <Text style={[styles.stateMessage, { color: theme.dividerText }]}>
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.retry, { borderColor: theme.cardBorder }]}
        >
          <Text style={[styles.retryText, { color: theme.inputText }]}>
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ProfileUserListScreen({ kind }: { kind: ProfileListKind }) {
  const params = useLocalSearchParams<{ username?: string }>();
  const username = usernameParam(params.username);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { user: viewer } = useSessionContext();
  const { runWithInstallToken } = useInstall();
  const { profile, status: profileStatus, reload } = useProfile(username);
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<ListState>({
    error: null,
    items: [],
    key: "",
    status: "loading",
  });
  const requestKey = `${profile?.id ?? "profile"}:${kind}:${reloadToken}`;

  useEffect(() => {
    if (!viewer || !profile?.id) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const items = await fetchProfileUserList(profile.id, kind, {
          apiBase: getApiBaseUrl(),
          cookie: await authClient.getCookie(),
        });
        if (active) {
          setState({ error: null, items, key: requestKey, status: "success" });
        }
      } catch (error) {
        if (active) {
          setState({
            error:
              error instanceof Error ? error.message : `Couldn't load ${kind}.`,
            items: [],
            key: requestKey,
            status: "error",
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [kind, profile?.id, requestKey, viewer]);

  const visibleState =
    state.key === requestKey
      ? state
      : { error: null, items: [], key: requestKey, status: "loading" as const };

  const selectTab = (next: ProfileListKind) => {
    if (next === kind) {
      return;
    }
    router.replace(
      next === "followers"
        ? `/users/${encodeURIComponent(username)}/followers`
        : `/users/${encodeURIComponent(username)}/following`
    );
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/users/${encodeURIComponent(username)}`);
  };

  const toggleFollow = useCallback(
    async (item: ProfileUserListItem, event: GestureResponderEvent) => {
      event.stopPropagation();
      if (!viewer) {
        router.push("/(auth)/login");
        return;
      }
      if (item.id === viewer.id || pendingIds.has(item.id)) {
        return;
      }
      const next = !item.isFollowing;
      setPendingIds((current) => new Set(current).add(item.id));
      setState((current) => ({
        ...current,
        items: current.items.map((entry) =>
          entry.id === item.id ? { ...entry, isFollowing: next } : entry
        ),
      }));
      try {
        const result = await runWithInstallToken(
          async () =>
            mutateFollow(item.id, next, {
              apiBase: getApiBaseUrl(),
              cookie: await authClient.getCookie(),
            }),
          (value) => value.kind === "install-token-required"
        );
        if (!result || result.kind !== "success") {
          setState((current) => ({
            ...current,
            items: current.items.map((entry) =>
              entry.id === item.id
                ? { ...entry, isFollowing: item.isFollowing }
                : entry
            ),
          }));
          if (result?.kind === "error") {
            toast({
              description: result.message,
              title: next ? "Follow Failed" : "Unfollow Failed",
              variant: "destructive",
            });
          }
          setPendingIds((current) => {
            const nextPending = new Set(current);
            nextPending.delete(item.id);
            return nextPending;
          });
          return;
        }
        setState((current) => ({
          ...current,
          items: current.items.map((entry) =>
            entry.id === item.id
              ? { ...entry, isFollowing: result.isFollowedByUser }
              : entry
          ),
        }));
        setPendingIds((current) => {
          const nextPending = new Set(current);
          nextPending.delete(item.id);
          return nextPending;
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          items: current.items.map((entry) =>
            entry.id === item.id
              ? { ...entry, isFollowing: item.isFollowing }
              : entry
          ),
        }));
        toast({
          description:
            error instanceof Error
              ? error.message
              : "That didn't go through. Try again.",
          title: next ? "Follow Failed" : "Unfollow Failed",
          variant: "destructive",
        });
        setPendingIds((current) => {
          const nextPending = new Set(current);
          nextPending.delete(item.id);
          return nextPending;
        });
      }
    },
    [pendingIds, router, runWithInstallToken, viewer]
  );

  const openUser = (item: ProfileUserListItem) => {
    router.push({
      params: { username: item.username },
      pathname: "/users/[username]",
    });
  };

  const renderItem = ({ item }: { item: ProfileUserListItem }) => {
    const pending = pendingIds.has(item.id);
    let followLabel = "Follow";
    if (item.isFollowing) {
      followLabel = "Following";
    }
    if (pending) {
      followLabel = "…";
    }
    return (
      <Pressable
        accessibilityLabel={`Open @${item.username}'s profile`}
        accessibilityRole="link"
        onPress={() => openUser(item)}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: pressed ? theme.passkeyBg : theme.containerBg,
            borderBottomColor: theme.cardBorder,
          },
        ]}
      >
        <UserAvatar size={48} url={item.avatarUrl} />
        <View style={styles.rowCopy}>
          <Text
            numberOfLines={1}
            style={[styles.rowName, { color: theme.inputText }]}
          >
            {item.displayName || item.username}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.rowHandle, { color: theme.dividerText }]}
          >
            @{item.username}
            {item.bio ? ` · ${item.bio}` : ""}
          </Text>
        </View>
        {viewer && item.id !== viewer.id ? (
          <Pressable
            accessibilityLabel={
              item.isFollowing
                ? `Unfollow @${item.username}`
                : `Follow @${item.username}`
            }
            accessibilityRole="button"
            accessibilityState={{ busy: pending }}
            disabled={pending}
            onPress={(event) => {
              void toggleFollow(item, event);
            }}
            style={[
              styles.followButton,
              item.isFollowing && styles.followingButton,
            ]}
          >
            <Text
              style={[
                styles.followText,
                item.isFollowing && styles.followingText,
              ]}
            >
              {followLabel}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  if (!username) {
    return (
      <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
        <ListStateView
          message="This profile link is incomplete."
          title="Profile unavailable"
        />
      </View>
    );
  }

  let content: React.ReactNode;
  if (!viewer) {
    content = (
      <View style={styles.stateView}>
        <Text style={[styles.stateTitle, { color: theme.inputText }]}>
          Log in to see this list
        </Text>
        <Text style={[styles.stateMessage, { color: theme.dividerText }]}>
          Followers and following are visible to signed-in members.
        </Text>
        <Pressable
          accessibilityLabel={`Log in to view ${kind}`}
          accessibilityRole="button"
          onPress={() => router.push("/(auth)/login")}
          style={[styles.loginButton, { backgroundColor: "#f97316" }]}
        >
          <Text style={styles.loginText}>Log in</Text>
        </Pressable>
      </View>
    );
  } else if (profileStatus === "loading") {
    content = (
      <View style={styles.stateView}>
        <Spinner3D size={48} />
        <Text style={[styles.stateMessage, { color: theme.dividerText }]}>
          Loading {kind}…
        </Text>
      </View>
    );
  } else if (profileStatus === "error" || !profile) {
    content = (
      <ListStateView
        message="Check your connection and try again."
        onRetry={reload}
        title="Couldn't load this profile"
      />
    );
  } else if (visibleState.status === "loading") {
    content = (
      <View style={styles.stateView}>
        <Spinner3D size={48} />
        <Text style={[styles.stateMessage, { color: theme.dividerText }]}>
          Loading {kind}…
        </Text>
      </View>
    );
  } else if (visibleState.status === "error") {
    content = (
      <ListStateView
        message={visibleState.error ?? `Couldn't load ${kind}.`}
        onRetry={() => setReloadToken((value) => value + 1)}
        title="Couldn't load this list"
      />
    );
  } else {
    content = (
      <FlatList
        {...LIST_VIRTUALIZATION_PROPS}
        contentContainerStyle={[
          styles.list,
          visibleState.items.length === 0 && styles.emptyList,
        ]}
        data={visibleState.items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <ListStateView
            message={
              kind === "followers"
                ? "Followers will show up here."
                : "Accounts this profile follows will show up here."
            }
            title={`No ${kind} yet`}
          />
        }
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
    );
  }

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: theme.containerBg, paddingTop: insets.top },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to profile"
          accessibilityRole="button"
          hitSlop={8}
          onPress={goBack}
          style={styles.backButton}
        >
          <ArrowLeft color={theme.inputText} size={22} />
        </Pressable>
        <Text
          numberOfLines={1}
          style={[styles.title, { color: theme.inputText }]}
        >
          {kind === "followers" ? "Followers" : "Following"}
        </Text>
        <View style={styles.backButton}>
          <UserRound color={theme.dividerText} size={20} />
        </View>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.subtitle, { color: theme.dividerText }]}
      >
        @{username}
      </Text>
      <FeedTabs active={kind} fill onChange={selectTab} tabs={LIST_TABS} />
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  emptyList: { flexGrow: 1 },
  followButton: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  followText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 13 },
  followingButton: {
    backgroundColor: "transparent",
    borderColor: "#f97316",
    borderWidth: 1,
  },
  followingText: { color: "#f97316" },
  header: {
    alignItems: "center",
    flexDirection: "row",
    height: 52,
    justifyContent: "space-between",
    paddingHorizontal: 6,
  },
  list: { paddingBottom: 28 },
  loginButton: {
    borderRadius: 9999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  loginText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 14 },
  retry: {
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: { fontFamily: "SofiaProMed", fontSize: 14 },
  root: { flex: 1 },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowHandle: { fontFamily: "SofiaProReg", fontSize: 13, marginTop: 3 },
  rowName: { fontFamily: "SofiaProBold", fontSize: 15 },
  stateMessage: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    textAlign: "center",
  },
  stateTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  stateView: {
    alignItems: "center",
    flex: 1,
    gap: 10,
    justifyContent: "center",
    padding: 28,
  },
  subtitle: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  title: { fontFamily: "SofiaProBold", fontSize: 17 },
});
