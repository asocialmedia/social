"use client";

import type { PostData, UserCommunityRole, UserData } from "@asm/db";
import type { ExternalAuthor } from "@asm/protocols/contracts";
import { Tabs, TabsContent, TabsList } from "@asm/ui/shadui/tabs";
import { ArrowLeft, Search, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

import { useSession } from "@/app/(main)/session-provider";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import ShareButton from "@/components/home/feedview/share-button";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import MediaGallery, {
  MediaGalleryContent,
  MediaGalleryLocked,
} from "@/components/profile/media-gallery";
import ProfileHeader from "@/components/profile/profile-header";
import UserAmplifiedFeed from "@/components/profile/user-amplified-feed";
import UserGustsFeed from "@/components/profile/user-gusts-feed";
import UserPostsFeed from "@/components/profile/user-posts-feed";
import UserRepliesFeed from "@/components/profile/user-replies-feed";
import UserResponsesFeed from "@/components/profile/user-responses-feed";
import { ExternalAuthorFeed } from "@/components/protocols/external-author-feed";
import { useSpotlight } from "@/components/search/spotlight-provider";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useFeedScrollMemory } from "@/hooks/feed/use-feed-scroll-memory";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import type { PrivateUserData } from "@/hooks/users/use-user-data";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import {
  resolveProfileTab,
  useTabMemoryReady,
  useTabStore,
} from "@/store/tab-store";
import type { ProfileTab } from "@/store/tab-store";

interface ProfilePageProps {
  initialGuestPosts?: PostData[];
  external?: ExternalAuthor;
  communityRoles: UserCommunityRole[];
  loggedInUserData: PrivateUserData | null;
  userData: UserData;
}

// Mobile swipe order mirrors the rendered tab strip. Guests never get
// Responses/Eddies/Amplified, so swipes skip them instead of bouncing to login.
const LOGGED_IN_TAB_ORDER: ProfileTab[] = [
  "posts",
  "gusts",
  "responses",
  "replies",
  "amplified",
  "media",
];
const GUEST_TAB_ORDER: ProfileTab[] = ["posts", "gusts", "media"];

const ClientProfile: React.FC<ProfilePageProps> = ({
  initialGuestPosts,
  userData,
  loggedInUserData,
  communityRoles,
  external,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const isXl = useMediaQuery("(min-width: 1280px)");
  const router = useRouter();
  const { openSpotlight } = useSpotlight();
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  const { goToLogin } = useRequireAuth();
  const memoryReady = useTabMemoryReady();
  const profileUserId = userData.id;
  const setProfileTab = useTabStore((state) => state.setProfileTab);
  // Scroll position is per profile AND per tab: leaving for a post and
  // coming back lands exactly where you left.
  useFeedScrollMemory({
    containerRef: feedScrollRef,
    memoryKey: `profile:${profileUserId}:${activeTab}`,
  });

  // Restore this profile's remembered tab once storage is ready. Memory is
  // keyed per user id, so Lisa can sit on Media while Harsh sits on Gusts,
  // and navigating between profiles swaps to each profile's own tab. The
  // entry is read imperatively so profile switches re-run the effect without
  // subscribing this component to every other profile's writes.
  useEffect(() => {
    // oxlint-disable-next-line react/no-deriving-state-in-effects, react/set-state-in-effect -- the remembered tab lives in localStorage (unavailable during SSR), so it can only be adopted after mount; deriving during render would mismatch the server HTML.
    setActiveTab(
      resolveProfileTab(
        useTabStore.getState().profileByUserId[profileUserId],
        external ? true : isLoggedIn,
        external ? false : isXl,
        memoryReady
      )
    );
  }, [isLoggedIn, isXl, memoryReady, profileUserId, external]);

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
        !external &&
        !isLoggedIn &&
        value !== "posts" &&
        value !== "gusts" &&
        value !== "media"
      ) {
        goToLogin();
        return;
      }
      setActiveTab(value as ProfileTab);
      setProfileTab(profileUserId, value as ProfileTab);
    },
    [goToLogin, isLoggedIn, profileUserId, setProfileTab, external]
  );

  // Mobile swipes drag the tab strip like a carousel (same mechanism as the
  // home feed); guests swipe through their reduced tab set.
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      let tabOrder = isLoggedIn ? LOGGED_IN_TAB_ORDER : GUEST_TAB_ORDER;
      if (external) {
        tabOrder = ["posts", "replies", "media"];
      }
      const nextIndex = tabOrder.indexOf(activeTab) + direction;
      if (nextIndex >= 0 && nextIndex < tabOrder.length) {
        handleTabChange(tabOrder[nextIndex]);
      }
    },
    [activeTab, handleTabChange, isLoggedIn, external]
  );
  useFeedSwipeNavigation(feedScrollRef, handleSwipeNavigate);

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
                className={`hide-native-scrollbar h-full touch-auto overflow-x-hidden overflow-y-auto ${
                  isLoggedIn ? "pb-24 lg:pb-0" : "pb-44 lg:pb-20"
                }`}
                ref={feedScrollRef}
              >
                <div className="relative">
                  <ProfileHeader
                    external={external}
                    communityRoles={communityRoles}
                    isOwnProfile={isOwnProfile}
                    ownUserData={loggedInUserData}
                    userData={userData}
                  />
                  <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3">
                    <button
                      aria-label="Go back"
                      className="rail-3d-btn flex size-10 items-center justify-center rounded-full active:scale-95"
                      onClick={handleGoBack}
                      type="button"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <fieldset
                      className="rail-3d-btn flex items-center rounded-full p-0.5"
                      aria-label="Profile actions"
                    >
                      <button
                        aria-label="Search"
                        className="flex size-10 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
                        onClick={() => openSpotlight()}
                        type="button"
                      >
                        <Search className="size-5" />
                      </button>
                      <ShareButton
                        triggerVariant="embedded"
                        className="h-10! w-10! text-white!"
                        iconClassName="size-5!"
                        defaultTab="link"
                        description={
                          userData.bio ||
                          `Check out @${userData.username}'s profile on asocialmedia`
                        }
                        dialogDescription="Share this profile with your network"
                        dialogTitle="Share Profile"
                        shareUrl={
                          typeof window === "undefined"
                            ? undefined
                            : `${window.location.origin}${external ? blueskyProfilePath(external.id) : `/users/${userData.username}`}`
                        }
                        thumbnail={userData.avatarUrl || undefined}
                        title={`${userData.displayName || userData.username} (@${userData.username}) on asocialmedia`}
                      />
                      <button
                        aria-label="Settings"
                        className="flex size-10 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
                        onClick={handleOpenSettings}
                        type="button"
                      >
                        <Settings className="size-5" />
                      </button>
                    </fieldset>
                  </div>
                </div>

                {/* z-30 keeps this sticky bar above later-painted content
                    overlays inside the scroller (e.g. the explicit-media
                    gate's z-10 blur/popup) instead of tying on z-index. */}
                <div
                  className="border-border/60 hide-native-scrollbar sticky top-0 z-30 w-full overflow-x-auto overscroll-x-contain border-b bg-[hsl(var(--background-alt))]/95 py-1.5 backdrop-blur-md"
                  data-profile-tabs-scroll
                >
                  <TabsList
                    aria-label="Profile sections"
                    className="mx-auto flex w-max min-w-full items-center justify-center gap-0 bg-transparent p-0 *:shrink-0"
                  >
                    <AnimatedTabTrigger
                      active={activeTab === "posts"}
                      layoutId="profile-tab-indicator"
                      value="posts"
                    >
                      Posts
                    </AnimatedTabTrigger>
                    {external ? (
                      <AnimatedTabTrigger
                        active={activeTab === "replies"}
                        layoutId="profile-tab-indicator"
                        value="replies"
                      >
                        Replies
                      </AnimatedTabTrigger>
                    ) : (
                      <>
                        <AnimatedTabTrigger
                          active={activeTab === "gusts"}
                          layoutId="profile-tab-indicator"
                          value="gusts"
                        >
                          Gusts
                        </AnimatedTabTrigger>
                        <AnimatedTabTrigger
                          active={activeTab === "responses"}
                          layoutId="profile-tab-indicator"
                          value="responses"
                        >
                          Responses
                        </AnimatedTabTrigger>
                        <AnimatedTabTrigger
                          active={activeTab === "replies"}
                          layoutId="profile-tab-indicator"
                          value="replies"
                        >
                          Eddies
                        </AnimatedTabTrigger>
                        <AnimatedTabTrigger
                          active={activeTab === "amplified"}
                          layoutId="profile-tab-indicator"
                          value="amplified"
                        >
                          Amplified
                        </AnimatedTabTrigger>
                      </>
                    )}
                    <AnimatedTabTrigger
                      active={activeTab === "media"}
                      className={external ? undefined : "xl:hidden"}
                      layoutId="profile-tab-indicator"
                      value="media"
                    >
                      Media
                    </AnimatedTabTrigger>
                  </TabsList>
                </div>

                {external ? (
                  (["posts", "replies", "media"] as const).map((tab) => (
                    <TabsContent className="mt-0 pb-12" key={tab} value={tab}>
                      <ExternalAuthorFeed actor={external.id} tab={tab} />
                    </TabsContent>
                  ))
                ) : (
                  <>
                    <TabsContent className="mt-0 pb-12" value="posts">
                      <UserPostsFeed
                        initialGuestPosts={initialGuestPosts}
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
                        <TabsContent className="mt-0 pb-12" value="responses">
                          <UserResponsesFeed
                            isOwnProfile={isOwnProfile}
                            userId={userData.id}
                          />
                        </TabsContent>

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
                        <MediaGalleryContent bare userId={userData.id} />
                      ) : (
                        <MediaGalleryLocked bare />
                      )}
                    </TabsContent>
                  </>
                )}
              </div>
              <FeedScrollbar containerRef={feedScrollRef} />
            </div>
          </Tabs>
        </div>

        {external ? null : (
          <MediaGallery locked={!isLoggedIn} userId={userData.id} />
        )}
      </div>
    </div>
  );
};

export default ClientProfile;
