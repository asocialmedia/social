// Native port of web's SuggestedFollowButton (components/recommendations/
// suggested-follow-button.tsx): the h-7 full-width pill under a suggested
// account card. Guests are sent to log in, Bluesky accounts follow through the
// external-follow hook, and the viewer's own account shows no button.
import type { RecommendedAccount } from "@asm/protocols/discovery";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  btnGray,
  followButtonShadows,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
} from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { mutateExploreFollow } from "@/features/explore/lib/explore-api";
import { useExternalFollow } from "@/features/feed/state/use-external-follow";
import { invalidateProtocolResources } from "@/features/network/state/use-protocol-resource";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

// `.btn-3d-on-brand` resting and :active.
const ON_BRAND = {
  colors: ["#ffffff", "#eef5ff"] as const,
  pressedColors: ["#dceaff", "#cfe1ff"] as const,
  pressedShadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.8), inset 0 1px 2px rgba(0, 40, 100, 0.28), 0 0 0 1px rgba(3, 55, 130, 0.7)",
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 1), inset 0 1.5px 2px #ffffff, 0 0 0 1px rgba(3, 55, 130, 0.55), 0 1px 2px rgba(0, 40, 100, 0.3)",
  text: "#0866df",
};

function FollowPill({
  blue,
  disabled,
  label,
  neutral,
  onPress,
}: {
  blue: boolean;
  disabled?: boolean;
  label: string;
  neutral: boolean;
  onPress: () => void;
}) {
  const { isDark } = useAppTheme();
  const gray = btnGray(isDark);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? styles.disabled : null}
    >
      {({ pressed }) => {
        let colors: readonly [string, string] = pressed
          ? ORANGE_PRESSED_GRADIENT
          : ORANGE_GRADIENT;
        let shadows = followButtonShadows(isDark);
        let color = "#ffffff";
        if (blue) {
          colors = pressed ? ON_BRAND.pressedColors : ON_BRAND.colors;
          shadows = pressed ? ON_BRAND.pressedShadows : ON_BRAND.shadows;
          color = ON_BRAND.text;
        } else if (neutral) {
          ({
            colors,
            shadows,
            text: color,
          } = pressed ? gray.pressed : gray.resting);
        }
        return (
          <Gradient3D colors={colors} shadows={shadows} style={styles.pill}>
            <Text numberOfLines={1} style={[styles.label, { color }]}>
              {label}
            </Text>
          </Gradient3D>
        );
      }}
    </Pressable>
  );
}

function BlueskyFollow({
  account,
  blue,
}: {
  account: RecommendedAccount;
  blue: boolean;
}) {
  const external = useExternalFollow(account.id, true);
  return (
    <FollowPill
      blue={blue}
      disabled={external.pending}
      label={external.following ? "Following" : "Follow"}
      neutral={external.following}
      onPress={() => {
        void external.toggle();
      }}
    />
  );
}

function NativeFollow({
  account,
  blue,
}: {
  account: RecommendedAccount;
  blue: boolean;
}) {
  const [following, setFollowing] = useState(account.following);
  const [pending, setPending] = useState(false);
  const toggle = async () => {
    setPending(true);
    try {
      const next = await mutateExploreFollow(account.id, !following, {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      });
      setFollowing(next.isFollowedByUser);
      invalidateProtocolResources("discovery-suggestions:");
    } catch {
      // The pill keeps its previous state; the next tap retries.
    }
    setPending(false);
  };
  let label = following ? "Following" : "Follow";
  if (pending) {
    label = "Updating…";
  }
  return (
    <FollowPill
      blue={blue}
      disabled={pending}
      label={label}
      neutral={following}
      onPress={() => {
        void toggle();
      }}
    />
  );
}

export function SuggestedFollowButton({
  account,
  blue,
  onAuthRedirect,
}: {
  account: RecommendedAccount;
  blue: boolean;
  onAuthRedirect: () => void;
}) {
  const { user } = useSessionContext();
  const router = useRouter();
  if (!user) {
    return (
      <FollowPill
        blue={blue}
        label="Follow"
        neutral={false}
        onPress={() => {
          onAuthRedirect();
          router.push("/login");
        }}
      />
    );
  }
  if (account.source === "bluesky") {
    return <BlueskyFollow account={account} blue={blue} />;
  }
  if (account.id === user.id) {
    return null;
  }
  return <NativeFollow account={account} blue={blue} />;
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.7,
  },
  label: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  pill: {
    height: 28,
    paddingHorizontal: 12,
    width: "100%",
  },
});
