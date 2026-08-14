"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { useCallback, useRef, useState } from "react";

import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import SettingsSearch from "@/components/settings/settings-search";
import type { SettingsTab } from "@/components/settings/settings-search";
import SettingsSidebar from "@/components/settings/settings-sidebar";

import AccountSettings from "./tabs/account-settings";
import ProfileSettings from "./tabs/profile-settings";
import SecuritySettings from "./tabs/security-settings";

interface ClientSettingsProps {
  user: UserData;
}

export default function ClientSettings({ user }: ClientSettingsProps) {
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value as SettingsTab);
  }, []);

  const handleNavigate = useCallback((tab: SettingsTab, sectionId?: string) => {
    setActiveTab(tab);
    if (sectionId) {
      window.setTimeout(() => {
        document
          .querySelector(`#${sectionId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    }
  }, []);

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={user} />

      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={handleTabChange}
          value={activeTab}
        >
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
            <MobileTopBar />
            <div className="border-border/60 relative flex items-center border-b py-1.5">
              <TabsList className="flex h-full flex-1 items-center justify-center gap-0 bg-transparent p-0 md:justify-start">
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="profile">
                  Profile
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="account">
                  Account
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="security">
                  Security
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
              className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto"
              ref={feedScrollRef}
            >
              <TabsContent className="mt-0 pb-12" value="profile">
                <ProfileSettings user={user} />
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="account">
                <AccountSettings user={user} />
              </TabsContent>

              <TabsContent className="mt-0 pb-12" value="security">
                <SecuritySettings user={user} />
              </TabsContent>
            </div>
            <FeedScrollbar containerRef={feedScrollRef} />
          </div>
        </Tabs>
      </div>

      <SettingsSidebar user={user} />
      <MobileBottomNav />
    </div>
  );
}
