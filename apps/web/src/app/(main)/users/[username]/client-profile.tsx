"use client";

import type { PrivateUserData, UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList } from "@asm/ui/shadui/tabs";
import { ArrowLeft, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

import { useSession } from "@/app/(main)/session-provider";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
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
import { useFeedSwipeNavigation } from "@/hooks/use-feed-swipe-navigation";
import { useRequireAuth } from "@/hooks/use-require-auth";

interface ProfilePageProps {
  loggedInUserData: PrivateUserData | null;
  userData: UserData;
}

type ProfileTab = "posts" | "gusts" | "replies" | "amplified" | "media";

// Mobile swipe order mirrors the rendered tab strip. Guests never get
// Replies/Amplified, so swipes skip them instead of bouncing to login.
const LOGGED_IN_TAB_ORDER: ProfileTab[] = [
  "posts",
  "gusts",
  "replies",
  "amplified",
  "media",
];
const GUEST_TAB_ORDER: ProfileTab[] = ["posts", "gusts", "media"];

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

  const handleGoBack = useCallback(() => {
    // Return to wherever the user came from (e.g. a post opened via a swipe);
    // only land on the home feed when there is no prior entry to go back to.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
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

  // Mobile swipes drag the tab strip like a carousel (same mechanism as the
  // home feed); guests swipe through their reduced tab set.
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const tabOrder = isLoggedIn ? LOGGED_IN_TAB_ORDER : GUEST_TAB_ORDER;
      const nextIndex = tabOrder.indexOf(activeTab) + direction;
      if (nextIndex >= 0 && nextIndex < tabOrder.length) {
        handleTabChange(tabOrder[nextIndex]);
      }
    },
    [activeTab, handleTabChange, isLoggedIn]
  );
  useFeedSwipeNavigation(feedScrollRef, handleSwipeNavigate);

  // The media tab only exists below xl; once the sidebar takes over, hop back to posts.
  const [prevLayoutInputs, setPrevLayoutInputs] = useState({ activeTab, isXl });
  if (
    prevLayoutInputs.activeTab !== activeTab ||
    prevLayoutInputs.isXl !== isXl
  ) {
    setPrevLayoutInputs({ activeTab, isXl });
    if (isXl && activeTab === "media") {
      setActiveTab("posts");
    }
  }

  const isOwnProfile = loggedInUserData
    ? userData.id === loggedInUserData.id
    : false;

  // The mobile media tab is a compact fixed-height section, not the full-height
  // desktop sidebar. bare hides the skeleton grid background so only the
  // message shows, and scrolling is enabled inside the fixed height so long
  // galleries can be browsed.
  return (
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
                className={`hide-native-scrollbar h-full touch-pan-y overflow-x-hidden overflow-y-auto ${
                  isLoggedIn ? "pb-16 lg:pb-0" : "pb-44 lg:pb-20"
                }`}
                ref={feedScrollRef}
              >
                <div className="relative">
                  <ProfileHeader
                    isOwnProfile={isOwnProfile}
                    ownUserData={loggedInUserData}
                    userData={userData}
                  />
                  <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3 md:hidden">
                    <button
                      aria-label="Go back"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:brightness-110 active:translate-y-px"
                      onClick={handleGoBack}
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

                {/* z-30 keeps this sticky bar above later-painted content
                    overlays inside the scroller (e.g. the explicit-media
                    gate's z-10 blur/popup) instead of tying on z-index. */}
                <div className="border-border/60 sticky top-0 z-30 flex items-center justify-center border-b bg-[hsl(var(--background-alt))]/95 py-1.5 backdrop-blur-md">
                  <TabsList className="flex items-center justify-center gap-0 bg-transparent p-0">
                    <AnimatedTabTrigger
                      active={activeTab === "posts"}
                      layoutId="profile-tab-indicator"
                      value="posts"
                    >
                      Posts
                    </AnimatedTabTrigger>
                    <AnimatedTabTrigger
                      active={activeTab === "gusts"}
                      layoutId="profile-tab-indicator"
                      value="gusts"
                    >
                      Gusts
                    </AnimatedTabTrigger>
                    <AnimatedTabTrigger
                      active={activeTab === "replies"}
                      layoutId="profile-tab-indicator"
                      value="replies"
                    >
                      Replies
                    </AnimatedTabTrigger>
                    <AnimatedTabTrigger
                      active={activeTab === "amplified"}
                      layoutId="profile-tab-indicator"
                      value="amplified"
                    >
                      Amplified
                    </AnimatedTabTrigger>
                    <AnimatedTabTrigger
                      active={activeTab === "media"}
                      className="xl:hidden"
                      layoutId="profile-tab-indicator"
                      value="media"
                    >
                      Media
                    </AnimatedTabTrigger>
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
                  <div className="hide-native-scrollbar h-72 overflow-y-auto">
                    {isLoggedIn ? (
                      <MediaGalleryContent bare userId={userData.id} />
                    ) : (
                      <MediaGalleryLocked bare />
                    )}
                  </div>
                </TabsContent>
              </div>
              <FeedScrollbar containerRef={feedScrollRef} />
            </div>
          </Tabs>
        </div>

        <MediaGallery locked={!isLoggedIn} userId={userData.id} />
      </div>
    </div>
  );
};

export default ClientProfile;
