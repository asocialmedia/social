"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { useCallback, useRef, useState } from "react";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import MediaGallery from "@/components/profile/media-gallery";
import ProfileHeader from "@/components/profile/profile-header";
import UserPostsFeed from "@/components/profile/user-posts-feed";
import UserRepliesFeed from "@/components/profile/user-replies-feed";

interface ProfilePageProps {
  loggedInUserData: UserData;
  userData: UserData;
}

type ProfileTab = "posts" | "replies";

const ClientProfile: React.FC<ProfilePageProps> = ({
  userData,
  loggedInUserData,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value as ProfileTab);
  }, []);

  const isOwnProfile = userData.id === loggedInUserData.id;

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={loggedInUserData} />

      <div className="flex min-w-0 flex-1">
        <div className="mx-auto flex w-full min-w-0 max-w-[88rem]">
          <div className="flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
            <Tabs
              className="flex min-h-0 flex-1 flex-col"
              onValueChange={handleTabChange}
              value={activeTab}
            >
              <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
                <MobileTopBar />
              </div>

              <div className="relative min-h-0 flex-1">
                <div
                  className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
                  ref={feedScrollRef}
                >
                  <ProfileHeader
                    isOwnProfile={isOwnProfile}
                    userData={userData}
                  />

                  <div className="sticky top-0 z-10 flex items-center justify-center border-border/60 border-b bg-[hsl(var(--background-alt))]/95 py-1.5 backdrop-blur-md">
                    <TabsList className="flex items-center justify-center gap-0 bg-transparent p-0">
                      <TabsTrigger className={TAB_TRIGGER_CLASS} value="posts">
                        Posts
                      </TabsTrigger>
                      <TabsTrigger
                        className={TAB_TRIGGER_CLASS}
                        value="replies"
                      >
                        Replies
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent className="mt-0 pb-12" value="posts">
                    <UserPostsFeed userId={userData.id} />
                  </TabsContent>

                  <TabsContent className="mt-0 pb-12" value="replies">
                    <UserRepliesFeed userId={userData.id} />
                  </TabsContent>
                </div>
                <FeedScrollbar containerRef={feedScrollRef} />
              </div>
            </Tabs>
          </div>

          <MediaGallery userId={userData.id} />
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default ClientProfile;
