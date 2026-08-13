"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { ArrowLeft, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MediaGallery, {
  MediaGalleryContent,
} from "@/components/profile/media-gallery";
import ProfileHeader from "@/components/profile/profile-header";
import UserPostsFeed from "@/components/profile/user-posts-feed";
import UserRepliesFeed from "@/components/profile/user-replies-feed";

interface ProfilePageProps {
  loggedInUserData: UserData;
  userData: UserData;
}

type ProfileTab = "posts" | "replies" | "media";

const ClientProfile: React.FC<ProfilePageProps> = ({
  userData,
  loggedInUserData,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const isXl = useMediaQuery("(min-width: 1280px)");
  const router = useRouter();

  const handleGoHome = useCallback(() => {
    router.push("/");
  }, [router]);

  const handleOpenSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value as ProfileTab);
  }, []);

  // The media tab only exists below xl; once the sidebar takes over, hop back to posts.
  useEffect(() => {
    if (isXl && activeTab === "media") {
      setActiveTab("posts");
    }
  }, [activeTab, isXl]);

  const isOwnProfile = userData.id === loggedInUserData.id;

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={loggedInUserData} />

      <div className="flex min-w-0 flex-1">
        <div className="mx-auto flex w-full min-w-0 max-w-[88rem] justify-center">
          <div className="flex min-w-0 flex-1 flex-col border-border/60 bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
            <Tabs
              className="flex min-h-0 flex-1 flex-col"
              onValueChange={handleTabChange}
              value={activeTab}
            >
              <div className="relative min-h-0 flex-1">
                <div
                  className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
                  ref={feedScrollRef}
                >
                  <div className="relative">
                    <ProfileHeader
                      isOwnProfile={isOwnProfile}
                      userData={userData}
                    />
                    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3 md:hidden">
                      <button
                        aria-label="Go back to home"
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110 active:translate-y-px"
                        onClick={handleGoHome}
                        type="button"
                      >
                        <ArrowLeft className="h-5 w-5" />
                      </button>
                      <button
                        aria-label="Settings"
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110 active:translate-y-px"
                        onClick={handleOpenSettings}
                        type="button"
                      >
                        <Settings className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

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
                      <TabsTrigger
                        className={`${TAB_TRIGGER_CLASS} xl:hidden`}
                        value="media"
                      >
                        Media
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent className="mt-0 pb-12" value="posts">
                    <UserPostsFeed
                      isOwnProfile={isOwnProfile}
                      userId={userData.id}
                    />
                  </TabsContent>

                  <TabsContent className="mt-0 pb-12" value="replies">
                    <UserRepliesFeed userId={userData.id} />
                  </TabsContent>

                  <TabsContent className="mt-0 pb-12 xl:hidden" value="media">
                    <MediaGalleryContent userId={userData.id} />
                  </TabsContent>
                </div>
                <FeedScrollbar containerRef={feedScrollRef} />
              </div>
            </Tabs>
          </div>

          <MediaGallery userId={userData.id} />
        </div>
      </div>
    </div>
  );
};

export default ClientProfile;
