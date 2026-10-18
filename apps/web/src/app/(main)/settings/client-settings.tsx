"use client";

import { visibleTabScrollOffset } from "@asm/ui/lib/tab-scroll";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import type { AccountLinkingReadiness } from "@/components/settings/linked-accounts";
import NetworkSettings from "@/components/settings/network-settings";
import {
  getNetworkSubpage,
  networkSubpageForSection,
} from "@/components/settings/network-subpages";
import type { NetworkSubpage } from "@/components/settings/network-subpages";
import PersonalizationSettings from "@/components/settings/personalization-settings";
import SettingsSearch from "@/components/settings/settings-search";
import type { SettingsTab } from "@/components/settings/settings-search";
import SettingsSidebar from "@/components/settings/settings-sidebar";
import {
  adjacentSettingsTab,
  getSettingsTab,
  isSettingsTab,
  settingsDocumentTitle,
} from "@/components/settings/settings-tab-state";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import { useHorizontalDragScroll } from "@/hooks/use-horizontal-drag-scroll";
import { writeSettingsSearchParam } from "@/hooks/use-settings-search-param";
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
  useHorizontalDragScroll(tabsRef);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    getSettingsTab(searchParams)
  );
  // The open Network section is URL state too (?section=content), so Back from a
  // section returns to the Network hub rather than leaving Settings.
  const [networkSection, setNetworkSection] = useState<NetworkSubpage | null>(
    () => getNetworkSubpage(searchParams)
  );
  const [hasExplicitTab, setHasExplicitTab] = useState(() =>
    searchParams.has("tab")
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
    document.title = settingsDocumentTitle(
      activeTab,
      networkSection,
      hasExplicitTab
    );
  }, [activeTab, hasExplicitTab, networkSection]);

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

  // Every Network section must have the hub behind it in history, otherwise
  // Back skips past the hub to whatever tab came before. Opening a section from
  // the hub already pushes that entry; arriving directly at one (a refresh or a
  // shared link) does not, so seed it here. The current URL keeps its state and
  // a synthetic hub entry is stacked underneath.
  useEffect(() => {
    if (!networkSection) {
      return;
    }
    if (window.history.state?.asmHub) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.delete("section");
    const hubUrl = `${window.location.pathname}?${params.toString()}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(
      { ...window.history.state, asmHub: true },
      "",
      hubUrl
    );
    window.history.pushState(window.history.state, "", currentUrl);
    // Only on mount (and when the tab/section set changes), never per render.
  }, [networkSection]);

  // One listener for the whole URL: Back across tabs and Back out of a Network
  // section both land here, so the address bar and the view can never disagree.
  useEffect(() => {
    const restoreFromHistory = () => {
      const params = new URLSearchParams(window.location.search);
      activateTab(getSettingsTab(params));
      setNetworkSection(getNetworkSubpage(params));
      setHasExplicitTab(params.has("tab"));
    };
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, [activateTab]);

  // Settings has no parent route of its own, so back is browser history when
  // there is somewhere to return to and Home when the page was opened directly.
  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }, [router]);

  const setPersistedTab = useCallback(
    (tab: SettingsTab) => {
      activateTab(tab);
      // A tab switch is a navigation: pushing it makes the browser's Back
      // button walk back through the tabs the reader actually visited instead
      // of jumping out of Settings. Picking the tab that is already open is not
      // a navigation and must not stack a duplicate entry.
      if (tab !== activeTab) {
        writeSettingsSearchParam({ key: "tab", mode: "push", value: tab });
      }
      setHasExplicitTab(true);
    },
    [activateTab, activeTab]
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

  const openNetworkSection = useCallback((next: NetworkSubpage | null) => {
    setNetworkSection(next);
    // Opening a section is a navigation; returning to the hub pops it.
    if (next) {
      writeSettingsSearchParam({ key: "section", mode: "push", value: next });
      return;
    }
    if (new URLSearchParams(window.location.search).has("section")) {
      window.history.back();
      return;
    }
    writeSettingsSearchParam({ key: "section", value: null });
  }, []);

  const handleNavigate = useCallback(
    (tab: SettingsTab, sectionId?: string) => {
      setPersistedTab(tab);
      if (tab === "network" && sectionId) {
        // Network sections live on their own pages now. Opening the matching
        // one before the scroll lands means search never targets an absent node.
        const nextSection = networkSubpageForSection(sectionId);
        if (nextSection) {
          openNetworkSection(nextSection);
        }
      }
      if (sectionId) {
        window.setTimeout(() => {
          document
            .querySelector(`#${sectionId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      }
    },
    [openNetworkSection, setPersistedTab]
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
            <MobileTopBar onBack={handleBack} />
            <div className="border-border/60 relative flex items-center border-b py-1.5">
              <TabsList
                aria-label="Settings sections"
                className="tab-strip-fade hide-native-scrollbar flex h-full min-w-0 flex-1 snap-x snap-proximity items-center justify-start gap-0 overflow-x-auto rounded-none! bg-transparent p-0 select-none md:justify-start [&>[role=tab]]:shrink-0 [&>[role=tab]]:snap-start"
                ref={tabsRef}
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
                className="mt-0 flex min-h-full flex-col pb-0 data-[state=inactive]:hidden"
                forceMount={visitedTabs.has("network") || undefined}
                value="network"
              >
                <NetworkSettings
                  onOpenSection={openNetworkSection}
                  section={networkSection}
                />
              </TabsContent>
              <TabsContent
                className="mt-0 flex min-h-full flex-col pb-0 data-[state=inactive]:hidden"
                forceMount={visitedTabs.has("personalization") || undefined}
                value="personalization"
              >
                <PersonalizationSettings />
              </TabsContent>
              <TabsContent
                className="mt-0 flex min-h-full flex-col pb-0 data-[state=inactive]:hidden"
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
                className="mt-0 flex min-h-full flex-col pb-0 data-[state=inactive]:hidden"
                forceMount={visitedTabs.has("account") || undefined}
                value="account"
              >
                <AccountSettings
                  accountLinkingReadiness={accountLinkingReadiness}
                  user={user}
                />
              </TabsContent>

              <TabsContent
                className="mt-0 flex min-h-full flex-col pb-0 data-[state=inactive]:hidden"
                forceMount={visitedTabs.has("privacy") || undefined}
                value="privacy"
              >
                <PrivacySettings user={user} />
              </TabsContent>

              <TabsContent
                className="mt-0 flex min-h-full flex-col pb-0 data-[state=inactive]:hidden"
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
    </>
  );
}
