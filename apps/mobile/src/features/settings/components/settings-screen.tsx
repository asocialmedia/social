// The settings screen: web's three tabs (profile / account / security) over one
// route. Web renders a desktop sidebar and keeps the active tab in `?tab=`;
// native mirrors the mobile web layout: the top bar, the shared tab strip, the
// mobile search row, then the active tab's scroll content and the bottom dock.
//
// The tab strip is the same `FeedTabs` every other tabbed page uses (so its
// height matches), and the three tabs live inside a `FeedPager`, so a tab
// change or a horizontal swipe swaps only the content. The route param is kept
// in sync with `router.setParams`, which updates in place and never remounts
// the screen, so switching tabs no longer refreshes the header, search or data.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { ScrollView as ScrollViewType } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedPager } from "@/features/feed/components/feed-pager";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { getApiBaseUrl } from "@/lib/api-env";
import { haptic } from "@/lib/haptics";
import { useAppTheme } from "@/theme";

import { fetchSecurityState } from "../lib/security-api";
import { scrollToSection } from "../lib/settings-scroll";
import { resolveSettingsTab, SETTINGS_TAB_DEFS } from "../lib/settings-tabs";
import type { SettingsTab } from "../lib/settings-tabs";
import {
  accountFactsFrom,
  withLinkedAccounts,
} from "../lib/settings-view-model";
import type { LinkedAccountInfo } from "../lib/settings-view-model";
import { AccountTab } from "./account-tab";
import { ProfileTab } from "./profile-tab";
import { SecurityTab } from "./security-tab";
import { SettingsSearch } from "./settings-search";
import {
  SettingsCardSkeleton,
  SettingsHeaderSkeleton,
} from "./settings-skeleton";

export function SettingsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    section?: string | string[];
    tab?: string | string[];
  }>();
  const { refresh, user } = useSessionContext();
  const tab = resolveSettingsTab(params.tab);
  const activeIndex = Math.max(
    0,
    SETTINGS_TAB_DEFS.findIndex((def) => def.value === tab)
  );

  // One scroll ref per tab, so a section scroll targets the right ScrollView
  // even while the other tabs stay mounted in the pager.
  const scrollRefs = useMemo(
    () => ({
      account: { current: null as ScrollViewType | null },
      profile: { current: null as ScrollViewType | null },
      security: { current: null as ScrollViewType | null },
    }),
    []
  );

  // Session-derived facts are computed during render; the server-side security
  // facts web's `settings/page.tsx` reads (verified TOTP row, linked accounts,
  // password presence) are fetched and merged once.
  const baseFacts = useMemo(() => accountFactsFrom(user), [user]);
  const [linked, setLinked] = useState<LinkedAccountInfo | null>(null);
  const [hasAuthenticatorApp, setHasAuthenticatorApp] = useState(false);
  const [securityLoaded, setSecurityLoaded] = useState(false);
  const facts = linked ? withLinkedAccounts(baseFacts, linked) : baseFacts;
  const [accountsToken, setAccountsToken] = useState(0);

  const section = Array.isArray(params.section)
    ? params.section[0]
    : params.section;

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const state = await fetchSecurityState({
        apiBase: getApiBaseUrl(),
        cookie: (await authClient.getCookie()) ?? "",
      });
      if (cancelled) {
        return;
      }
      if (state) {
        setLinked({
          hasPassword: state.hasPassword,
          linkedProviders: state.linkedProviders,
        });
        setHasAuthenticatorApp(state.hasAuthenticatorApp);
      }
      setSecurityLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- accountsToken re-reads after a link/unlink
  }, [user, accountsToken]);

  const onChanged = useCallback(() => {
    void refresh();
    setAccountsToken((token) => token + 1);
  }, [refresh]);

  // `setParams` updates the current route in place: the screen, header and
  // search never remount, only the pager's active page changes.
  const goToTab = useCallback(
    (next: SettingsTab, sectionId?: string) => {
      router.setParams({ section: sectionId ?? "", tab: next });
      if (sectionId) {
        scrollToSection(sectionId, scrollRefs);
      }
    },
    [router, scrollRefs]
  );

  const handleIndexChange = useCallback(
    (index: number) => {
      const def = SETTINGS_TAB_DEFS[index];
      if (def && def.value !== tab) {
        haptic();
        router.setParams({ section: "", tab: def.value });
      }
    },
    [router, tab]
  );

  // A deep link (or a search selection) carries a section; scroll once the tab
  // that owns it has rendered. The retry loop inside scrollToSection handles
  // the layout race.
  useEffect(() => {
    if (section) {
      scrollToSection(section, scrollRefs);
    }
  }, [section, scrollRefs]);

  const userForHeader = user
    ? {
        id: user.id,
        image: user.image,
        username: user.username ?? user.name,
      }
    : null;

  const securityReady = securityLoaded || !user;

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader user={userForHeader} />
      <View style={styles.chrome}>
        <FeedTabs
          active={tab}
          onChange={(next) => goToTab(next)}
          tabs={SETTINGS_TAB_DEFS}
        />
        <View
          style={[styles.searchRow, { borderBottomColor: theme.cardBorder }]}
        >
          <SettingsSearch onNavigate={goToTab} />
        </View>
      </View>

      <FeedPager activeIndex={activeIndex} onIndexChange={handleIndexChange}>
        <ProfileTab
          onChanged={onChanged}
          onNavigateToAccount={() => goToTab("account", "settings-username")}
          scrollRef={scrollRefs.profile}
          user={user}
        />
        <AccountTab
          facts={facts}
          onChanged={onChanged}
          scrollRef={scrollRefs.account}
        />
        {securityReady ? (
          <SecurityTab
            active={tab === "security"}
            key={user?.id ?? "guest"}
            email={facts.email}
            emailVerified={facts.emailVerified}
            hasAuthenticatorApp={hasAuthenticatorApp}
            scrollRef={scrollRefs.security}
            twoFactorEnabled={user?.twoFactorEnabled === true}
          />
        ) : (
          <ScrollView
            contentContainerStyle={styles.securitySkeleton}
            showsVerticalScrollIndicator={false}
          >
            <SettingsHeaderSkeleton />
            <SettingsCardSkeleton fields={2} />
            <SettingsCardSkeleton fields={1} />
          </ScrollView>
        )}
      </FeedPager>

      <MobileBottomNav />
    </View>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  chrome: { zIndex: 20 },
  root: { flex: 1 },
  // Web's mobile search row: the same 16px horizontal gutter as the tab strip
  // content and tab bodies, with a bottom hairline matching the strip above.
  searchRow: {
    borderBottomWidth: 1,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 50,
  },
  securitySkeleton: { gap: 18, padding: 16, paddingBottom: 96 },
});
