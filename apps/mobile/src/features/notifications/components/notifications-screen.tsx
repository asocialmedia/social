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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  GestureResponderEvent,
  PanResponderGestureState,
} from "react-native";
import {
  Animated,
  FlatList,
  Linking,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  PanResponder,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import errorImage from "@/assets/images/error.png";
import noNotificationsImage from "@/assets/images/noNotifications.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import {
  HEADER_BAR_HEIGHT,
  reportFeedScroll,
} from "@/features/feed/lib/header-visibility";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import {
  MobileHeader,
  headerSlide,
} from "@/features/home/components/mobile-header";
import { unreadCountStore } from "@/features/notifications/state/unread-store";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import type {
  GroupedNotificationItem,
  NotificationTab,
} from "../lib/notifications-api";
import {
  fetchNotificationsPage,
  groupFetchedNotifications,
} from "../lib/notifications-api";
import { registerForPushNotifications } from "../lib/push";
import {
  getPushSetupStatus,
  pushSetupCopy,
  readPushSetupStatus,
  subscribePushSetupStatus,
} from "../lib/push-setup";
import type { PushSetupStatus } from "../lib/push-setup";
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
  const unread = useUnreadNotificationCount(viewerId, showUser);
  const insets = useSafeAreaInsets();
  const [dockHeight, setDockHeight] = useState(56);
  const { runWithInstallToken } = useInstall();
  const registrationStatus = useSyncExternalStore(
    subscribePushSetupStatus,
    readPushSetupStatus,
    readPushSetupStatus
  );
  const [devicePushStatus, setDevicePushStatus] =
    useState<PushSetupStatus | null>(null);
  const pushStatus = registrationStatus ?? devicePushStatus;
  useEffect(() => {
    let active = true;
    const update = async () => {
      const status = await getPushSetupStatus();
      if (active) {
        setDevicePushStatus(status);
      }
    };
    void update();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void update();
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

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
        const grouped = groupFetchedNotifications(page.notifications);
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

  const handleSwipe = useCallback(
    (direction: "left" | "right") => {
      if (direction === "left" && activeTab === "all") {
        setActiveTab("mentions");
      } else if (direction === "right" && activeTab === "mentions") {
        setActiveTab("all");
      }
    },
    [activeTab]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (
          _: GestureResponderEvent,
          gestureState: PanResponderGestureState
        ) =>
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
          Math.abs(gestureState.dx) > 10,
        onPanResponderRelease: (
          _: GestureResponderEvent,
          gestureState: PanResponderGestureState
        ) => {
          if (Math.abs(gestureState.dx) > 50) {
            handleSwipe(gestureState.dx > 0 ? "right" : "left");
          }
        },
      }),
    [handleSwipe]
  );

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
      <Animated.View
        style={[
          styles.content,
          {
            // The header slides up and away on scroll; the tab strip and the list
            // below it travel the same distance, so the strip takes the header's
            // place instead of leaving a gap above it. This is the same shared
            // value HomeScreen follows, so the two screens stay in step.
            // marginBottom extends the content below the fold so translating up
            // does not expose a blank strip at the bottom.
            marginBottom: -HEADER_BAR_HEIGHT,
            transform: [
              {
                translateY: headerSlide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -HEADER_BAR_HEIGHT],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.tabs}>
          <FeedTabs
            active={activeTab}
            onChange={(tab) => setActiveTab(tab)}
            tabs={TAB_DEFS}
          />
        </View>
        {pushStatus && pushStatus.reason !== "ready" ? (
          <View
            style={[
              styles.pushBanner,
              { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.pushTitle, { color: theme.inputText }]}>
              {pushSetupCopy(pushStatus).title}
            </Text>
            <Text style={[styles.pushBody, { color: theme.dividerText }]}>
              {pushSetupCopy(pushStatus).body}
            </Text>
            {pushSetupCopy(pushStatus).action &&
            pushStatus.reason !== "expo-go" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (pushStatus.reason === "permission-denied") {
                    void Linking.openSettings();
                  } else {
                    void registerForPushNotifications(runWithInstallToken);
                  }
                }}
              >
                <Text style={{ color: theme.auxLink, paddingVertical: 8 }}>
                  {pushSetupCopy(pushStatus).action}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <FlatList
          {...LIST_VIRTUALIZATION_PROPS}
          {...panResponder.panHandlers}
          // flexGrow lets the empty/loading/error slot centre vertically instead
          // of collapsing to the top; harmless once rows exist.
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: HEADER_BAR_HEIGHT + dockHeight + insets.bottom + 12,
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
              <NotificationRow notification={item} onOpen={handleOpen} />
            </View>
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
        />
      </Animated.View>
      <MobileBottomNav onHeightChange={setDockHeight} />
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
  // The tab strip and the list travel together as the header hides. flex: 1
  // lets the list absorb the space the header vacates.
  content: {
    flex: 1,
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
  pushBanner: {
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
  },
  pushBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    marginTop: 4,
  },
  pushTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 13,
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
