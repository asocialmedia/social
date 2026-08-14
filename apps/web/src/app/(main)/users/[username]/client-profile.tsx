"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { ArrowLeft, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

import { useSession } from "@/app/(main)/session-provider";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MediaGallery, {
  MediaGalleryContent,
  MediaGalleryLocked,
} from "@/components/profile/media-gallery";
import ProfileHeader from "@/components/profile/profile-header";
import UserAmplifiedFeed from "@/components/profile/user-amplified-feed";
import UserGustsFeed from "@/components/profile/user-gusts-feed";
import UserPostsFeed from "@/components/profile/user-posts-feed";
import UserRepliesFeed from "@/components/profile/user-replies-feed";
import { useRequireAuth } from "@/hooks/use-require-auth";

interface ProfilePageProps {
  loggedInUserData: UserData | null;
  userData: UserData;
}

type ProfileTab = "posts" | "gusts" | "replies" | "amplified" | "media";

const ClientProfile: React.FC<ProfilePageProps> = ({
  userData,
  loggedInUserData,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const isXl = useMediaQuery("(min-width: 1280px)");
  const router = useRouter();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const { goToLogin } = useRequireAuth();

  const handleGoHome = useCallback(() => {
    router.push("/");
  }, [router]);

  const handleOpenSettings = useCallback(() => {
    if (isLoggedIn) {
      router.push("/settings");
    } else {
      goToLogin();
    }
  }, [goToLogin, isLoggedIn, router]);

  // Replies and Amplified need an account; guests see those tabs but a click
  // bounces them to login. Media is also locked for guests, but the tab shows
  // the same locked gallery as the desktop sidebar instead of redirecting.
  const handleTabChange = useCallback(
    (value: string) => {
      if (
        !isLoggedIn &&
        value !== "posts" &&
        value !== "gusts" &&
        value !== "media"
      ) {
        goToLogin();
        return;
      }
      setActiveTab(value as ProfileTab);
    },
    [goToLogin, isLoggedIn]
  );

  // The media tab only exists below xl; once the sidebar takes over, hop back to posts.
  useEffect(() => {
    if (isXl && activeTab === "media") {
      // eslint-disable-next-line react-compiler -- reset the tab when the layout switches to the media sidebar
      setActiveTab("posts");
    }
  }, [activeTab, isXl]);

  const isOwnProfile = loggedInUserData
    ? userData.id === loggedInUserData.id
    : false;

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={loggedInUserData} />

      <div className="flex min-w-0 flex-1">
        <div className="mx-auto flex w-full max-w-[88rem] min-w-0 justify-center">
          <div className="border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
            <Tabs
              className="flex min-h-0 flex-1 flex-col"
              onValueChange={handleTabChange}
              value={activeTab}
            >
              <div className="relative min-h-0 flex-1">
                <div
                  className={`hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto ${
                    isLoggedIn ? "pb-16 lg:pb-0" : "pb-44 lg:pb-20"
                  }`}
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

                  <div className="border-border/60 sticky top-0 z-10 flex items-center justify-center border-b bg-[hsl(var(--background-alt))]/95 py-1.5 backdrop-blur-md">
                    <TabsList className="flex items-center justify-center gap-0 bg-transparent p-0">
                      <TabsTrigger className={TAB_TRIGGER_CLASS} value="posts">
                        Posts
                      </TabsTrigger>
                      <TabsTrigger className={TAB_TRIGGER_CLASS} value="gusts">
                        Gusts
                      </TabsTrigger>
                      <TabsTrigger
                        className={TAB_TRIGGER_CLASS}
                        value="replies"
                      >
                        Replies
                      </TabsTrigger>
                      <TabsTrigger
                        className={TAB_TRIGGER_CLASS}
                        value="amplified"
                      >
                        Amplified
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

                  <TabsContent className="mt-0 pb-12" value="gusts">
                    <UserGustsFeed
                      isOwnProfile={isOwnProfile}
                      userId={userData.id}
                    />
                  </TabsContent>

                  {isLoggedIn ? (
                    <>
                      <TabsContent className="mt-0 pb-12" value="replies">
                        <UserRepliesFeed userId={userData.id} />
                      </TabsContent>

                      <TabsContent className="mt-0 pb-12" value="amplified">
                        <UserAmplifiedFeed userId={userData.id} />
                      </TabsContent>
                    </>
                  ) : null}

                  <TabsContent className="mt-0 pb-12 xl:hidden" value="media">
                    {isLoggedIn ? (
                      <MediaGalleryContent userId={userData.id} />
                    ) : (
                      <MediaGalleryLocked />
                    )}
                  </TabsContent>
                </div>
                <FeedScrollbar containerRef={feedScrollRef} />
              </div>
            </Tabs>
          </div>

          <MediaGallery locked={!isLoggedIn} userId={userData.id} />
        </div>
      </div>
    </div>
  );
};

export default ClientProfile;
