"use client";

import { visibleTabScrollOffset } from "@asm/ui/lib/tab-scroll";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import type { AccountLinkingReadiness } from "@/components/settings/linked-accounts";
import NetworkSettings from "@/components/settings/network-settings";
import PersonalizationSettings from "@/components/settings/personalization-settings";
import SettingsSearch from "@/components/settings/settings-search";
import type { SettingsTab } from "@/components/settings/settings-search";
import SettingsSidebar from "@/components/settings/settings-sidebar";
import {
  adjacentSettingsTab,
  getSettingsTab,
  isSettingsTab,
} from "@/components/settings/settings-tab-state";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import type { PrivateUserData } from "@/hooks/users/use-user-data";

import AccountSettings from "./tabs/account-settings";
import PrivacySettings from "./tabs/privacy-settings";
import ProfileSettings from "./tabs/profile-settings";
import SecuritySettings from "./tabs/security-settings";
import type { SecurityPasskey, SecurityState } from "./tabs/security-settings";

interface ClientSettingsProps {
  accountLinkingReadiness: AccountLinkingReadiness;
  currentSessionId: string;
  initialPasskeys: SecurityPasskey[];
  securityState: SecurityState;
  user: PrivateUserData;
}

export default function ClientSettings({
  accountLinkingReadiness,
  currentSessionId,
  initialPasskeys,
  securityState,
  user,
}: ClientSettingsProps) {
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    getSettingsTab(searchParams)
  );

  const [visitedTabs, setVisitedTabs] = useState(
    () => new Set<SettingsTab>([getSettingsTab(searchParams)])
  );
  const activateTab = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
    setVisitedTabs((visited) =>
      visited.has(tab) ? visited : new Set([...visited, tab])
    );
  }, []);

  const revealTab = useCallback((selected: HTMLElement) => {
    const tabs = tabsRef.current;
    if (!tabs) {
      return;
    }
    const bounds = selected.getBoundingClientRect();
    const viewport = tabs.getBoundingClientRect();
    tabs.scrollTo({
      behavior: "auto",
      left: visibleTabScrollOffset({
        itemLeft: bounds.left - viewport.left + tabs.scrollLeft,
        itemWidth: bounds.width,
        offset: tabs.scrollLeft,
        viewportWidth: tabs.clientWidth,
      }),
    });
  }, []);

  useEffect(() => {
    const tabs = tabsRef.current;
    const selected = tabs?.querySelector<HTMLElement>(
      `[data-state="active"][data-settings-tab="${activeTab}"]`
    );
    if (!tabs || !selected) {
      return;
    }
    const revealSelected = () => {
      revealTab(selected);
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(tabs);
    observer.observe(selected);
    return () => observer.disconnect();
  }, [activeTab, revealTab]);

  useEffect(() => {
    const restoreTabFromHistory = () => {
      activateTab(getSettingsTab(new URLSearchParams(window.location.search)));
    };
    window.addEventListener("popstate", restoreTabFromHistory);
    return () => window.removeEventListener("popstate", restoreTabFromHistory);
  }, [activateTab]);

  const setPersistedTab = useCallback(
    (tab: SettingsTab) => {
      activateTab(tab);

      const nextSearchParams = new URLSearchParams(window.location.search);
      nextSearchParams.set("tab", tab);
      const query = nextSearchParams.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`
      );
    },
    [activateTab]
  );

  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const nextTab = adjacentSettingsTab(activeTab, direction);
      if (nextTab) {
        setPersistedTab(nextTab);
      }
    },
    [activeTab, setPersistedTab]
  );
  useFeedSwipeNavigation(feedScrollRef, handleSwipeNavigate, {
    ignoreSelector:
      'input, textarea, select, button, a, [contenteditable="true"], [role="slider"], [role="switch"]',
  });

  const handleTabChange = useCallback(
    (value: string) => {
      if (isSettingsTab(value)) {
        setPersistedTab(value);
      }
    },
    [setPersistedTab]
  );

  const handleNavigate = useCallback(
    (tab: SettingsTab, sectionId?: string) => {
      setPersistedTab(tab);
      if (sectionId) {
        window.setTimeout(() => {
          document
            .querySelector(`#${sectionId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      }
    },
    [setPersistedTab]
  );

  return (
    <>
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={handleTabChange}
          value={activeTab}
        >
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
            <MobileTopBar />
            <div className="border-border/60 relative flex items-center border-b py-1.5">
              <TabsList
                aria-label="Settings sections"
                ref={tabsRef}
                className="hide-native-scrollbar flex h-full min-w-0 flex-1 items-center justify-start gap-0 overflow-x-auto bg-transparent p-0 md:justify-start [&>[role=tab]]:shrink-0"
              >
                <TabsTrigger
                  className={TAB_TRIGGER_CLASS}
                  onClick={(event) => revealTab(event.currentTarget)}
                  data-settings-tab="profile"
                  value="profile"
                >
                  Profile
                </TabsTrigger>
                <TabsTrigger
                  className={TAB_TRIGGER_CLASS}
                  onClick={(event) => revealTab(event.currentTarget)}
                  data-settings-tab="account"
                  value="account"
                >
                  Account
                </TabsTrigger>
                <TabsTrigger
                  className={TAB_TRIGGER_CLASS}
                  onClick={(event) => revealTab(event.currentTarget)}
                  data-settings-tab="privacy"
                  value="privacy"
                >
                  Privacy
                </TabsTrigger>
                <TabsTrigger
                  className={TAB_TRIGGER_CLASS}
                  onClick={(event) => revealTab(event.currentTarget)}
                  data-settings-tab="security"
                  value="security"
                >
                  Security
                </TabsTrigger>
                <TabsTrigger
                  className={TAB_TRIGGER_CLASS}
                  onClick={(event) => revealTab(event.currentTarget)}
                  value="personalization"
                  data-settings-tab="personalization"
                >
                  Personalization
                </TabsTrigger>
                <TabsTrigger
                  className={TAB_TRIGGER_CLASS}
                  data-settings-tab="network"
                  onClick={(event) => revealTab(event.currentTarget)}
                  value="network"
                >
                  Network
                </TabsTrigger>
              </TabsList>
              <div className="ml-auto hidden min-w-0 items-center gap-2 pr-1.5 md:flex">
                <div className="w-full max-w-[24rem] xl:max-w-md">
                  <SettingsSearch onNavigate={handleNavigate} />
                </div>
              </div>
            </div>
            <div className="border-border/60 flex items-center gap-2 border-b px-3 py-2 md:hidden">
              <SettingsSearch onNavigate={handleNavigate} />
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              className="hide-native-scrollbar h-full touch-auto overflow-x-hidden overflow-y-auto"
              data-settings-scroll
              ref={feedScrollRef}
            >
              <TabsContent
                className="mt-0 pb-[calc(env(safe-area-inset-bottom)+6rem)] data-[state=inactive]:hidden lg:pb-12"
                forceMount={visitedTabs.has("network") || undefined}
                value="network"
              >
                <NetworkSettings />
              </TabsContent>
              <TabsContent
                className="mt-0 pb-[calc(env(safe-area-inset-bottom)+6rem)] data-[state=inactive]:hidden lg:pb-12"
                forceMount={visitedTabs.has("personalization") || undefined}
                value="personalization"
              >
                <PersonalizationSettings />
              </TabsContent>
              <TabsContent
                className="mt-0 pb-[calc(env(safe-area-inset-bottom)+6rem)] data-[state=inactive]:hidden lg:pb-12"
                forceMount={visitedTabs.has("profile") || undefined}
                value="profile"
              >
                <ProfileSettings
                  onNavigateToAccount={() =>
                    handleNavigate("account", "settings-username")
                  }
                  user={user}
                />
              </TabsContent>

              <TabsContent
                className="mt-0 pb-[calc(env(safe-area-inset-bottom)+6rem)] data-[state=inactive]:hidden lg:pb-12"
                forceMount={visitedTabs.has("account") || undefined}
                value="account"
              >
                <AccountSettings
                  accountLinkingReadiness={accountLinkingReadiness}
                  user={user}
                />
              </TabsContent>

              <TabsContent
                className="mt-0 pb-[calc(env(safe-area-inset-bottom)+6rem)] data-[state=inactive]:hidden lg:pb-12"
                forceMount={visitedTabs.has("privacy") || undefined}
                value="privacy"
              >
                <PrivacySettings user={user} />
              </TabsContent>

              <TabsContent
                className="mt-0 pb-[calc(env(safe-area-inset-bottom)+6rem)] data-[state=inactive]:hidden lg:pb-12"
                forceMount={visitedTabs.has("security") || undefined}
                value="security"
              >
                <SecuritySettings
                  currentSessionId={currentSessionId}
                  initialPasskeys={initialPasskeys}
                  securityState={securityState}
                  user={user}
                />
              </TabsContent>
            </div>
            <FeedScrollbar containerRef={feedScrollRef} />
          </div>
        </Tabs>
      </div>

      <SettingsSidebar user={user} />
      <MobileBottomNav />
    </>
  );
}
