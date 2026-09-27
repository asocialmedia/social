import { useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { ArrowLeft, Settings2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
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
  const [tabReady, setTabReady] = useState(false);
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
      if (active) {
        setTabReady(true);
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

  if (!username || status === "loading" || !tabReady) {
    return <LoadingProfile />;
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
  const header = (
    <View style={styles.headerFrame}>
      <View
        style={[styles.topBar, { top: insets.top > 0 ? insets.top + 6 : 14 }]}
      >
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.topButton}
        >
          <ArrowLeft color="#fff" size={20} />
        </Pressable>
        {own ? (
          <Pressable
            accessibilityLabel="Edit profile"
            accessibilityRole="button"
            onPress={() => setEditing(true)}
            style={styles.topButton}
          >
            <Settings2 color="#fff" size={19} />
          </Pressable>
        ) : (
          <View style={styles.topButtonSpacer} />
        )}
      </View>
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
      <ProfileTabs active={tab} onChange={selectTab} />
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
        tab={tab}
        viewerId={user?.id ?? null}
      />
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
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 12,
    position: "absolute",
    right: 0,
    top: 10,
    zIndex: 2,
  },
  topButton: {
    alignItems: "center",
    backgroundColor: "rgba(18, 20, 24, 0.45)",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderRadius: 20,
    borderWidth: 1,
    boxShadow:
      "inset 0 1px 1px rgba(255, 255, 255, 0.2), 0 2px 6px rgba(0, 0, 0, 0.3)",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  topButtonSpacer: { height: 40, width: 40 },
});
