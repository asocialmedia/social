import type { NotificationTarget } from "@asm/notifications/shared";
// Notifications screen: native port of web's Notifications page
// (app/(main)/notifications). All / Mentions tab strip, infinite cursor feed
// with grouped rows, mark-all-read on mount, per-row dismiss, and loading /
// error / empty states.
//
// Grouping and row copy come from @asm/notifications/shared, so the mobile and
// web feeds cannot drift. The unread badge is zeroed through the shared store,
// so the header and the bottom dock update in the same tick.
import { Image } from "expo-image";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import errorImage from "@/assets/images/error.png";
import noNotificationsImage from "@/assets/images/noNotifications.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import {
  HEADER_BAR_HEIGHT,
  reportFeedScroll,
} from "@/features/feed/lib/header-visibility";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { unreadCountStore } from "@/features/notifications/state/unread-store";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import type {
  GroupedNotificationItem,
  NotificationTab,
} from "../lib/notifications-api";
import {
  dismissNotifications,
  fetchNotificationsPage,
  groupFetchedNotifications,
} from "../lib/notifications-api";
import { NotificationRow } from "./notification-row";
import { NotificationsSkeleton } from "./notifications-skeleton";

const TAB_DEFS = [
  { label: "All", value: "all" as const },
  { label: "Mentions", value: "mentions" as const },
];

interface TabState {
  cursor: string | null;
  error: string | null;
  hasMore: boolean;
  items: GroupedNotificationItem[];
  status: "error" | "idle" | "loading" | "loading-more" | "success";
}

function emptyTab(): TabState {
  return {
    cursor: null,
    error: null,
    hasMore: true,
    items: [],
    status: "idle",
  };
}

export function NotificationsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { isPending, user } = useSessionContext();
  const viewerId = user?.id ?? null;
  const showUser = !isPending && Boolean(user);
  const [activeTab, setActiveTab] = useState<NotificationTab>("all");
  const [tabs, setTabs] = useState<Record<NotificationTab, TabState>>({
    all: emptyTab(),
    mentions: emptyTab(),
  });
  const inflight = useRef<NotificationTab | null>(null);
  // Ids dismissed this session, so an in-flight page cannot resurrect a row.
  const dismissedIds = useRef(new Set<string>());
  const unread = useUnreadNotificationCount(viewerId, showUser);

  const updateTab = useCallback(
    (tab: NotificationTab, patch: Partial<TabState>) => {
      setTabs((current) => ({
        ...current,
        [tab]: { ...current[tab], ...patch },
      }));
    },
    []
  );

  const loadPage = useCallback(
    async (tab: NotificationTab, mode: "append" | "replace") => {
      if (inflight.current === tab) {
        return;
      }
      inflight.current = tab;
      const current = tabs[tab];
      updateTab(tab, {
        error: null,
        status: mode === "append" ? "loading-more" : "loading",
      });
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        const page = await fetchNotificationsPage(
          tab,
          mode === "append" ? current.cursor : null,
          { apiBase, cookie }
        );
        // Rows dismissed while this page was in flight must not reappear.
        const grouped = groupFetchedNotifications(page.notifications).filter(
          (item) => !dismissedIds.current.has(item.id)
        );
        updateTab(tab, {
          cursor: page.nextCursor,
          hasMore: page.nextCursor !== null,
          items: mode === "append" ? [...current.items, ...grouped] : grouped,
          status: "success",
        });
        if (inflight.current === tab) {
          inflight.current = null;
        }
      } catch (error) {
        updateTab(tab, {
          error:
            error instanceof Error ? error.message : "Couldn't load rustles.",
          status: "error",
        });
        logWarn("notifications.fetch_failed", {
          reason: error instanceof Error ? error.message : String(error),
          tab,
        });
        // No finally: the React Compiler rejects try/finally, so the reset is
        // written on both paths (same reason as use-feed.ts).
        if (inflight.current === tab) {
          inflight.current = null;
        }
      }
    },
    [tabs, updateTab]
  );

  // Load a tab the first time it is shown. `tabs` in the deps keeps the guard
  // reading the latest cursor/status rather than a stale closure.
  useEffect(() => {
    if (!showUser) {
      return;
    }
    if (tabs[activeTab].status === "idle") {
      // oxlint-disable-next-line react/set-state-in-effect -- mount-fill: an idle tab enters loading here; the fetch settles it
      void loadPage(activeTab, "replace");
    }
  }, [activeTab, loadPage, showUser, tabs]);

  // Opening the screen marks everything read and zeroes the badge, like web.
  useEffect(() => {
    if (showUser) {
      void unreadCountStore.markAllRead();
    }
  }, [showUser]);

  const handleDismiss = useCallback(
    async (notification: GroupedNotificationItem) => {
      const ids =
        notification.allNotificationIds.length > 0
          ? notification.allNotificationIds
          : [notification.id];
      for (const id of ids) {
        dismissedIds.current.add(id);
      }
      setTabs((current) => ({
        ...current,
        [activeTab]: {
          ...current[activeTab],
          items: current[activeTab].items.filter(
            (item) => item.id !== notification.id
          ),
        },
      }));
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        await dismissNotifications(ids, { apiBase, cookie });
        void unreadCountStore.refresh();
      } catch (error) {
        logWarn("notifications.dismiss_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeTab]
  );

  const handleOpen = useCallback(
    (target: NotificationTarget) => {
      // Community and user targets have no native screen yet, so they resolve
      // to the feed rather than a dead route. Post targets are pushed by the
      // row itself, which owns the short-id conversion.
      if (target.kind === "community" || target.kind === "user") {
        router.push("/");
      }
    },
    [router]
  );

  const active = tabs[activeTab];

  const handleEndReached = useCallback(() => {
    if (active.hasMore && active.status === "success") {
      void loadPage(activeTab, "append");
    }
  }, [active.hasMore, active.status, activeTab, loadPage]);

  // The list's empty slot doubles as the loading and error surface, like web's
  // feedBody. Rendered by state so the JSX reads as one branch at a time.
  let listEmpty: React.ReactNode;
  if (active.status === "loading") {
    listEmpty = <NotificationsSkeleton />;
  } else if (active.status === "error") {
    listEmpty = (
      <View style={styles.centerWrap}>
        <Image contentFit="contain" source={errorImage} style={styles.art} />
        <Text style={[styles.emptyTitle, { color: "#dc2626" }]}>
          An error occurred while loading rustles.
        </Text>
        <Pressable
          hitSlop={8}
          onPress={() => loadPage(activeTab, "replace")}
          style={styles.retry}
        >
          <Text style={[styles.retryText, { color: theme.auxLink }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  } else {
    const mentions = activeTab === "mentions";
    listEmpty = (
      <View style={styles.centerWrap}>
        <Image
          contentFit="contain"
          source={noNotificationsImage}
          style={styles.art}
        />
        <Text style={[styles.emptyTitle, { color: theme.dividerText }]}>
          {mentions ? "No mentions yet" : "No rustles yet"}
        </Text>
        <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
          {mentions
            ? "Mentions of you in posts will show up here."
            : "Follows, amplifies, eddies and mentions will show up here."}
        </Text>
      </View>
    );
  }

  // Notifications are personal; web redirects signed-out visitors away from
  // /notifications. Guests can browse the feed, so a guest who lands here
  // (signed out elsewhere, or a stale push tap) goes back to it instead of a
  // dead-end placeholder.
  if (!showUser) {
    return isPending ? null : <Redirect href="/" />;
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        unreadCount={unread}
        user={
          user
            ? {
                avatarUrl: user.image ?? null,
                id: user.id,
                image: user.image ?? null,
                username: user.username ?? user.name,
              }
            : null
        }
      />
      <View style={styles.tabs}>
        <FeedTabs
          active={activeTab}
          fill
          onChange={(tab) => setActiveTab(tab)}
          tabs={TAB_DEFS}
        />
      </View>
      <FlatList
        // flexGrow lets the empty/loading/error slot centre vertically instead
        // of collapsing to the top; harmless once rows exist.
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: HEADER_BAR_HEIGHT,
        }}
        data={active.items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={
          active.status === "loading-more" ? <NotificationsSkeleton /> : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        onScroll={(event) =>
          reportFeedScroll(event.nativeEvent.contentOffset.y)
        }
        renderItem={({ item, index }) => (
          <View
            style={
              index > 0
                ? { borderTopColor: theme.cardBorder, borderTopWidth: 1 }
                : undefined
            }
          >
            <NotificationRow
              notification={item}
              onDismiss={handleDismiss}
              onOpen={handleOpen}
            />
          </View>
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      />
      <MobileBottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  art: {
    height: 160,
    width: "100%",
  },
  centerWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
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
  retry: {
    marginTop: 12,
  },
  retryText: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  root: {
    flex: 1,
  },
  tabs: {
    // FeedTabs owns its own bottom hairline; the wrapper only reserves space.
    flexShrink: 0,
  },
});
