// Root home page: mobile header, the four-tab feed (For you / Latest /
// Trending / Following) with swipe navigation, and the guest auth bar docked
// at the bottom. Ports web ClientHome's tab mechanics: the remembered tab
// restores from SecureStore-backed memory (logged-in users default to For
// you, guests to Latest), Following prompts guests to log in, and every tab
// keeps its own cached pages and scroll position.
import { useCallback, useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSessionContext } from "@/features/auth/state/session";
import { FeedList } from "@/features/feed/components/feed-list";
import { FeedPager } from "@/features/feed/components/feed-pager";
import { HOME_TAB_DEFS, FeedTabs } from "@/features/feed/components/feed-tabs";
import { HEADER_BAR_HEIGHT } from "@/features/feed/lib/header-visibility";
import type { HomeTab } from "@/features/feed/state/tab-store";
import { resolveHomeTab } from "@/features/feed/state/tab-store";
import {
  useHomeTabMemoryReady,
  useTabStore,
} from "@/features/feed/state/tab-store-native";
import { useUnreadNotificationCount } from "@/features/notifications/state/use-unread-count";
import { useAppTheme } from "@/theme";

import { GuestAuthBar } from "./guest-auth-bar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileHeader, headerSlide } from "./mobile-header";

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const { isPending, user } = useSessionContext();
  // While the session is still resolving, `user` is null for everyone. Treating
  // that as "guest" flashes the Log in pill at signed-in users, so neither the
  // avatar nor the guest bar renders until the answer is known.
  const showUser = !isPending && Boolean(user);
  const isLoggedIn = showUser;
  const memoryReady = useHomeTabMemoryReady();
  const storedHome = useTabStore((state) => state.home);
  const setHomeTab = useTabStore((state) => state.setHomeTab);
  // The bell badge polls here (the header is present on every signed-in
  // surface); the notifications screen reads the same store.
  const unreadCount = useUnreadNotificationCount(user?.id ?? null, showUser);
  const tab = resolveHomeTab(null, isLoggedIn, storedHome, memoryReady);
  // Web fixes both the guest banner and the bottom nav over the feed (the
  // feed pads its tail instead), so the dock floats over content on a
  // transparent backdrop rather than sitting in a solid band. Same here:
  // the banner sits at the bottom edge and rides a transform up above the
  // dock while it shows, dropping back down while the dock hides on scroll.
  const insets = useSafeAreaInsets();
  const [dockHeight, setDockHeight] = useState(56);
  const [dockHidden, setDockHidden] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const showGuestBar = !isPending && !user;
  const dockLift = dockHeight + insets.bottom + 20;
  // A transform, never a layout prop: tweening `bottom` or a margin runs on
  // the JS thread and re-lays out every frame, while translate runs natively
  // at 60fps. Same 220ms ease-out-cubic as the top bar and the dock, kicked
  // off on the same hide flip, so all three glide as one with zero layout
  // work. Tail padding never moves visible items, so it stays constant.
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; driven by the effect below
  const [bannerLift] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!showGuestBar) {
      return;
    }
    const anim = Animated.timing(bannerLift, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
      toValue: dockHidden ? 0 : 1,
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [bannerLift, dockHidden, showGuestBar]);
  const bannerTranslate = bannerLift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -dockLift],
  });
  const feedBottomPad = showGuestBar ? bannerHeight + dockLift + 12 : 0;
  const activeIndex = Math.max(
    0,
    HOME_TAB_DEFS.findIndex((entry) => entry.value === tab)
  );

  const handleTabChange = useCallback(
    (next: HomeTab) => {
      setHomeTab(next);
    },
    [setHomeTab]
  );

  const handleIndexChange = useCallback(
    (index: number) => {
      const def = HOME_TAB_DEFS[index];
      if (def && def.value !== tab) {
        setHomeTab(def.value);
      }
    },
    [setHomeTab, tab]
  );

  // Hide-on-scroll follow: tabs + feed translate by the bar height on the
  // same shared native value as the bar itself, so everything stays in
  // sync at 60fps with zero layout work. The content extends by the bar
  // height below the fold so translating up does not leave a blank strip
  // below the feed. No matching paddingBottom here: that would pull the
  // feed's bottom edge back up and bring the strip right back. FeedList's
  // own content padding keeps the last post reachable while the bar shows.
  const followUp = headerSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -HEADER_BAR_HEIGHT],
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        unreadCount={unreadCount}
        user={
          showUser && user
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
            marginBottom: -HEADER_BAR_HEIGHT,
            transform: [{ translateY: followUp }],
          },
        ]}
      >
        <FeedTabs active={tab} onChange={handleTabChange} />
        <View style={styles.feed}>
          <FeedPager
            activeIndex={activeIndex}
            onIndexChange={handleIndexChange}
          >
            {HOME_TAB_DEFS.map((def, index) => (
              // Only the visible tab fetches and probes: four parallel loops
              // would burn mobile data and backend capacity for hidden tabs.
              // Caches make switching back instant without refetching.
              // Public tabs fetch immediately as guest instead of waiting for
              // the session: first paint wins, and the session upgrade
              // re-keys (guest to user) and refetches with identity.
              <FeedList
                bottomInset={feedBottomPad}
                enabled={
                  index === activeIndex &&
                  // For you and Following are account-only; a guest sees the
                  // sign-in prompt in FeedList instead, and nothing is fetched.
                  (def.value === "following" || def.value === "personalized"
                    ? isLoggedIn
                    : true)
                }
                key={def.value}
                userId={user?.id}
                variant={def.value}
              />
            ))}
          </FeedPager>
        </View>
      </Animated.View>
      {showGuestBar ? (
        <Animated.View
          onLayout={(event) => {
            setBannerHeight(event.nativeEvent.layout.height);
          }}
          pointerEvents="box-none"
          style={{
            bottom: 0,
            left: 0,
            position: "absolute",
            right: 0,
            transform: [{ translateY: bannerTranslate }],
            // Above the dock so it slides out underneath the banner.
            zIndex: 60,
          }}
        >
          <GuestAuthBar />
        </Animated.View>
      ) : null}
      <MobileBottomNav
        onHeightChange={setDockHeight}
        onHiddenChange={setDockHidden}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
  feed: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
});
