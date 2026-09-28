import { useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { ArrowLeft, Settings2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Animated,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Spinner3D } from "@/components/feedback/spinner-3d";
import { toast } from "@/components/feedback/toast";
import { useSessionContext } from "@/features/auth/state/session";
import { useProfile, useProfileFeed } from "@/features/profile";
import { PROD_API_URL } from "@/lib/api-base";
import { useAppTheme } from "@/theme";

import {
  parseProfileTab,
  profileTabStorageKey,
} from "../lib/profile-tab-memory";
import type { ProfileViewTab } from "../lib/profile-tab-memory";
import { ProfileEditModal } from "./profile-edit-modal";
import { ProfileFeed } from "./profile-feed";
import { ProfileHeader } from "./profile-header";
import { ProfileSkeleton } from "./profile-skeleton";
import { ProfileTabs } from "./profile-tabs";

function LoadingProfile() {
  return (
    <View style={styles.center}>
      <Spinner3D size={56} />
      <Text style={styles.centerText}>Loading profile…</Text>
    </View>
  );
}

function usernameParam(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return value?.[0] ?? "";
}

export function ProfileScreen() {
  const params = useLocalSearchParams<{ username?: string }>();
  const username = usernameParam(params.username);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { user } = useSessionContext();
  const { profile, status, reload, follow, isFollowing } = useProfile(username);
  const [tab, setTab] = useState<ProfileViewTab>("posts");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const value = await SecureStore.getItemAsync(
          profileTabStorageKey(username)
        );
        if (active) {
          setTab(parseProfileTab(value));
        }
      } catch {
        if (active) {
          setTab("posts");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [username]);

  const selectTab = useCallback(
    (next: ProfileViewTab) => {
      if (!user && next !== "posts" && next !== "gusts" && next !== "media") {
        toast({
          description:
            "Log in to view Responses, Eddies, Amplified, and Media.",
          title: "Sign in required",
        });
        router.push("/(auth)/login");
        return;
      }
      setTab(next);
      void (async () => {
        try {
          await SecureStore.setItemAsync(profileTabStorageKey(username), next);
        } catch {
          // persistence is best effort
        }
      })();
    },
    [router, user, username]
  );

  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const tabOrder: readonly ProfileViewTab[] = user
        ? ["posts", "gusts", "responses", "eddies", "amplified", "media"]
        : ["posts", "gusts", "media"];
      const currentIndex = tabOrder.indexOf(tab);
      const nextIndex = currentIndex + direction;
      if (nextIndex >= 0 && nextIndex < tabOrder.length) {
        selectTab(tabOrder[nextIndex]);
      }
    },
    [selectTab, tab, user]
  );
  const guestAllowed = useMemo(() => tab === "posts" || tab === "gusts", [tab]);
  const feed = useProfileFeed({
    enabled: Boolean(profile?.id) && (Boolean(user) || guestAllowed),
    tab,
    username,
  });

  // The tab strip sits inside the header, which the feed renders as its
  // ListHeaderComponent, so it scrolls away with the banner. Measuring its
  // resting offset lets the feed pin a copy of the strip to the top once the
  // header has scrolled past. Measured rather than hardcoded because the
  // header's length varies with the wrapped bio, the safe-area inset, and the
  // guest sign-in gate below it. Declared above the early returns below, since
  // hooks cannot be introduced after a conditional return.
  const [tabsRestingY, setTabsRestingY] = useState<number | null>(null);
  const handleTabsLayout = useCallback((event: LayoutChangeEvent) => {
    // Read the offset out of the event before calling setState, never inside
    // the updater. React invokes the updater later, during the render phase, by
    // which point the synthetic event has been released and nativeEvent is
    // null, so touching it there throws "Cannot read property 'layout' of
    // null". The updater also has to stay pure, and this keeps it free of the
    // event entirely.
    const next = event.nativeEvent.layout.y;
    setTabsRestingY((current) => (current === next ? current : next));
  }, []);

  // The back button only earns its place while the profile header is on screen.
  // Once the tabs pin, the strip is the thing worth the top band, and a back
  // arrow sitting beside it reads as a second, competing control. Fading it out
  // hands the space to the strip and keeps the top edge unambiguous. It fades
  // back in on the way up, so it is always there at rest.
  //
  // These three sit above the early returns below, since hooks declared after
  // them would only run once a profile has loaded and change hook order between
  // renders.
  const backOpacity = useMemo(() => new Animated.Value(1), []);
  // Tracked as plain state too because the fade runs on the native driver, so JS
  // cannot read the animated value back. Without it a hidden back button would
  // still swallow taps in its corner.
  const [backVisible, setBackVisible] = useState(true);
  const handleTabsPinChange = useCallback(
    (pinned: boolean) => {
      setBackVisible(!pinned);
      Animated.timing(backOpacity, {
        duration: 140,
        toValue: pinned ? 0 : 1,
        useNativeDriver: true,
      }).start();
    },
    [backOpacity]
  );

  // Only the header is gated. The tab preference is read from SecureStore
  // because it is the persisted value for this user, and a cold read costs a
  // frame, so the screen paints with the default tab first and corrects itself
  // when the read lands rather than holding a spinner for it.
  if (!username) {
    return <LoadingProfile />;
  }
  if (status === "loading") {
    return <ProfileSkeleton activeTab={tab} />;
  }
  if (status === "error" || !profile) {
    return (
      <View style={styles.center}>
        <Text style={[styles.errorTitle, { color: theme.inputText }]}>
          Couldn't load this profile
        </Text>
        <Pressable
          onPress={reload}
          style={[styles.retry, { borderColor: theme.cardBorder }]}
        >
          <Text style={{ color: theme.inputText }}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const own = user?.id === profile.id;
  const locked = !user && tab === "media";
  const shareProfile = async () => {
    const url = `${PROD_API_URL}/users/${encodeURIComponent(profile.username)}`;
    try {
      await Share.share({
        message: `Check out @${profile.username} on asocialmedia`,
        url,
      });
    } catch {
      toast({
        description: "The profile was not shared.",
        title: "Share cancelled",
      });
    }
  };
  const handleFollow = async () => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    try {
      await follow(!isFollowing);
      toast({
        description: `@${profile.username}`,
        title: isFollowing ? "Unfollowed" : "Following",
      });
    } catch {
      toast({
        description: "Please try again.",
        title: "Couldn’t update follow",
        variant: "destructive",
      });
    }
  };

  // The back and settings buttons live outside the scroll view entirely. They
  // used to sit at the top of the header, which made them part of the list's
  // content: a pull-to-refresh dragged them down with the banner, and they were
  // useless the moment the header scrolled away. Rendered here as a fixed
  // overlay, they stay put and stay reachable at every scroll position.
  const settingsButton = (
    <Pressable
      accessibilityLabel="Edit profile"
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => setEditing(true)}
      style={({ pressed }) => [
        styles.topButton,
        pressed && styles.topButtonPressed,
      ]}
    >
      <Settings2 color="#fff" size={20} />
    </Pressable>
  );

  // The pinned strip sits directly under the status bar, in the same band as
  // these buttons rather than below them. Reserving a separate 40px row for the
  // buttons left roughly a hundred pixels of dead space above the tab labels on a
  // notched device, and that row existed only to stop the two colliding. They do
  // not collide: the strip only becomes visible once the header has scrolled
  // away, and by then the back button has faded out. The settings button stays,
  // floating above the strip, which is where it belongs.
  const stickyTop = insets.top > 0 ? insets.top + 6 : 14;

  const topBar = (
    <View style={[styles.topBar, { top: stickyTop }]}>
      <Animated.View
        pointerEvents={backVisible ? "auto" : "none"}
        style={{ opacity: backOpacity }}
      >
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace("/");
          }}
          style={({ pressed }) => [
            styles.topButton,
            pressed && styles.topButtonPressed,
          ]}
        >
          <ArrowLeft color="#fff" size={20} />
        </Pressable>
      </Animated.View>
      {own ? settingsButton : <View style={styles.topButtonSpacer} />}
    </View>
  );

  const header = (
    <View style={styles.headerFrame}>
      <ProfileHeader
        canFollow={!own}
        canMessage={!own}
        isFollowing={isFollowing}
        isOwnProfile={own}
        onEdit={() => setEditing(true)}
        onFollow={() => {
          void handleFollow();
        }}
        onMessage={() => {
          if (!user) {
            router.push("/(auth)/login");
            return;
          }
          toast({
            description: "There is no native messages destination yet.",
            title: "Messaging is coming soon",
          });
        }}
        onShare={() => {
          void shareProfile();
        }}
        profile={profile}
      />
      <View onLayout={handleTabsLayout}>
        <ProfileTabs active={tab} onChange={selectTab} />
      </View>
      {locked ? (
        <View style={styles.gate}>
          <Text style={[styles.gateTitle, { color: theme.inputText }]}>
            Sign in to see this profile’s media
          </Text>
          <Pressable
            onPress={() => router.push("/(auth)/login")}
            style={styles.loginButton}
          >
            <Text style={styles.loginText}>Log in</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <ProfileFeed
        feed={feed}
        header={header}
        isOwnProfile={own}
        locked={locked}
        onSwipeNavigate={handleSwipeNavigate}
        onTabsPinChange={handleTabsPinChange}
        refreshProfile={reload}
        // No safe-area padding here: the feed positions the pinned strip from
        // stickyTop, which is already derived from the inset. Adding paddingTop
        // as well counted the inset twice and pushed the tabs down.
        stickyTabs={<ProfileTabs active={tab} onChange={selectTab} />}
        stickyTop={stickyTop}
        tab={tab}
        tabsRestingY={tabsRestingY}
        topInset={insets.top}
        viewerId={user?.id ?? null}
      />
      {topBar}
      {editing ? (
        <ProfileEditModal
          onClose={() => setEditing(false)}
          onSaved={reload}
          profile={profile}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  centerText: { fontFamily: "SofiaProReg", fontSize: 14 },
  errorTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  gate: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    minHeight: 220,
    padding: 24,
  },
  gateTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  headerFrame: { position: "relative" },
  loginButton: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  loginText: { color: "#fff", fontFamily: "SofiaProMed", fontSize: 14 },
  retry: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },

  root: { flex: 1 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    height: 40,
    // Back on the trailing edge, settings on the leading one, so the pair is
    // spread the way it was before the back button was removed.
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 12,
    position: "absolute",
    right: 0,
    // top is supplied at the call site from the safe-area inset, so the bar
    // clears the notch and the punch-hole camera.
    // Above the pinned tab strip (zIndex 20). The strip is opaque and sits in the
    // same band, so a lower bar would be hidden behind it once it fades in.
    zIndex: 30,
  },
  topButton: {
    alignItems: "center",
    // Web: rounded-full bg-black/40 text-white backdrop-blur-md. The scrim is
    // plain translucent black, not the blue-tinted near-black this used to use.
    // No border, inset highlight, or drop shadow: the 3D ring is a profile-action
    // recipe, and web's overlay buttons deliberately have none - a ring here read
    // as a third styling language next to the Follow/Message buttons below.
    // RN has no backdrop-blur and expo-blur is not a dependency, so the blur is
    // approximated by the opacity alone, which is close over a photo banner.
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: 9999,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  // Web's active:translate-y-px, plus hover:bg-black/60 collapsed onto press
  // since touch has no hover. Web also brightens on hover (hover:brightness-110),
  // which needs a real brightness filter that RN StyleSheet cannot express
  // without a bitmap filter, so the scrim does the work instead.
  topButtonPressed: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    transform: [{ translateY: 1 }],
  },
  topButtonSpacer: { height: 40, width: 40 },
});
