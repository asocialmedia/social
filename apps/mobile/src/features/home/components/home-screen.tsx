// Root home page: mobile header, the four-tab feed (For you / Latest /
// Trending / Following) with swipe navigation, and the guest auth bar docked
// at the bottom. Ports web ClientHome's tab mechanics: the remembered tab
// restores from SecureStore-backed memory (logged-in users default to For
// you, guests to Latest), Following prompts guests to log in, and every tab
// keeps its own cached pages and scroll position.
import { useCallback } from "react";
import { Animated, StyleSheet, View } from "react-native";

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
import { useAppTheme } from "@/theme";

import { GuestAuthBar } from "./guest-auth-bar";
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
  const tab = resolveHomeTab(null, isLoggedIn, storedHome, memoryReady);
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
  // sync at 60fps with zero layout work. Relative positions never change,
  // so nothing overlaps and no background fill is needed.
  const followUp = headerSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -HEADER_BAR_HEIGHT],
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
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
        style={[styles.content, { transform: [{ translateY: followUp }] }]}
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
                enabled={
                  index === activeIndex &&
                  (def.value === "following" ? isLoggedIn : true)
                }
                key={def.value}
                userId={user?.id}
                variant={def.value}
              />
            ))}
          </FeedPager>
        </View>
      </Animated.View>
      {isPending || user ? null : <GuestAuthBar />}
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
