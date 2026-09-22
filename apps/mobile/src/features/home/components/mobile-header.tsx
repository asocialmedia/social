// 1:1 native port of web MobileTopBar
// (components/layouts/navigation/mobile/mobile-top-bar.tsx).
// Left: avatar (signed in) or spacer (guest). Center: asm logo pinned to the
// bar's centerline via a full-size centered overlay, linking home. Right:
// notification bell with unread badge + search (signed in) or a premium
// (orange 3D) Log in pill (guest). The avatar opens the profile popup (same
// content as web's UserProfilePopover); session, unread count, and search
// are props, while the popup fetches its own profile data.

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Bell, Search } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import asmLogo from "@/assets/images/asm.png";
import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import {
  AVATAR_RING_SHADOWS,
  AVATAR_RING_SHADOWS_DARK,
  ICON_BUTTON_SHADOWS_DARK,
  ICON_BUTTON_SHADOWS_LIGHT,
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_SHADOWS,
  useAppTheme,
} from "@/theme";

import { resolveProfileImageUrl } from "./profile-utils";
import { UserProfilePopup } from "./user-profile-popup";

interface MobileHeaderProps {
  onSearchPress?: () => void;
  unreadCount?: number;
  user?: { avatarUrl?: string | null; id: string; username: string } | null;
}

export function MobileHeader({
  onSearchPress,
  unreadCount = 0,
  user = null,
}: MobileHeaderProps) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // A remote avatar that fails to load (bad URL, offline) falls back to the
  // bundled placeholder instead of rendering an empty frame.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const iconShadows = isDark
    ? ICON_BUTTON_SHADOWS_DARK
    : ICON_BUTTON_SHADOWS_LIGHT;
  // Web UserAvatar renders 36px with the avatar-ring bevel over a muted
  // gradient; the header matches that frame exactly.
  const avatarUri = user?.avatarUrl
    ? resolveProfileImageUrl(user.avatarUrl, getApiBaseUrl())
    : null;

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ backgroundColor: theme.containerBg }}
    >
      <View
        style={[
          styles.bar,
          {
            backgroundColor: theme.containerBg,
            borderBottomColor: theme.cardBorder,
          },
        ]}
      >
        <View style={styles.sideLeft}>
          {user ? (
            <Pressable
              accessibilityLabel={`Open profile menu for ${user.username}`}
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => setProfileUserId(user.id)}
            >
              <View style={styles.avatarFrame}>
                <Image
                  contentFit="cover"
                  key={avatarUri ?? "placeholder"}
                  onError={() => {
                    logWarn("profile.header_avatar_failed", {});
                    setAvatarFailed(true);
                  }}
                  source={
                    avatarUri && !avatarFailed
                      ? { uri: avatarUri }
                      : avatarPlaceholder
                  }
                  style={[styles.avatar, { backgroundColor: theme.cardBg }]}
                />
                {/* avatar-ring bevel: boxShadow is not part of expo-image's
                    ImageStyle, so the ring rides an overlay like the web's
                    box-shadow layer does. */}
                <View
                  pointerEvents="none"
                  style={[
                    styles.avatarRing,
                    {
                      boxShadow: isDark
                        ? AVATAR_RING_SHADOWS_DARK
                        : AVATAR_RING_SHADOWS,
                    },
                  ]}
                />
              </View>
            </Pressable>
          ) : null}
        </View>

        {/* Full-bar centered overlay: the logo sits on the bar's centerline
            no matter how wide the side columns are (same as web). Touches
            pass through everywhere except the logo itself. */}
        <View pointerEvents="box-none" style={styles.centerOverlay}>
          <Pressable hitSlop={6} onPress={() => router.push("/")}>
            <Image
              accessibilityLabel="asocialmedia"
              contentFit="contain"
              source={asmLogo}
              style={styles.logo}
            />
          </Pressable>
        </View>

        <View
          style={[
            styles.sideRight,
            user ? styles.sideRightUser : styles.sideRightGuest,
          ]}
        >
          {user ? (
            <>
              <Pressable
                accessibilityLabel="Notifications"
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => router.push("/")}
              >
                {({ pressed }) => (
                  <View
                    style={[
                      styles.iconBtn,
                      {
                        backgroundColor: theme.passkeyBg,
                        boxShadow: iconShadows,
                      },
                      pressed && styles.pressedShift,
                    ]}
                  >
                    <Bell color={theme.passkeyIcon} size={20} />
                    {unreadCount > 0 ? (
                      <View
                        style={[
                          styles.badge,
                          { borderColor: theme.containerBg },
                        ]}
                      >
                        <LinearGradient
                          colors={["#ff9500", "#e65500"]}
                          end={{ x: 0.5, y: 1 }}
                          start={{ x: 0.5, y: 0 }}
                          style={styles.badgeGradient}
                        >
                          <Text style={styles.badgeText}>
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </Text>
                        </LinearGradient>
                      </View>
                    ) : null}
                  </View>
                )}
              </Pressable>
              <Pressable
                accessibilityLabel="Search"
                accessibilityRole="button"
                hitSlop={6}
                onPress={onSearchPress}
              >
                {({ pressed }) => (
                  <View
                    style={[
                      styles.iconBtn,
                      {
                        backgroundColor: theme.passkeyBg,
                        boxShadow: iconShadows,
                      },
                      pressed && styles.pressedShift,
                    ]}
                  >
                    <Search color={theme.passkeyIcon} size={20} />
                  </View>
                )}
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => router.push("/(auth)/login")}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.loginPill,
                    {
                      boxShadow: pressed
                        ? LOGIN_BUTTON_PRESSED_SHADOWS
                        : LOGIN_BUTTON_SHADOWS,
                    },
                    pressed && styles.pressedShift,
                  ]}
                >
                  <LinearGradient
                    colors={["#ff9500", "#e65500"]}
                    end={{ x: 0.5, y: 1 }}
                    start={{ x: 0.5, y: 0 }}
                    style={styles.loginPillGradient}
                  >
                    <Text style={styles.loginPillText}>Log in</Text>
                  </LinearGradient>
                </View>
              )}
            </Pressable>
          )}
        </View>
      </View>
      <UserProfilePopup
        onClose={() => setProfileUserId(null)}
        userId={profileUserId}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: 12,
    height: 36,
    width: 36,
  },
  avatarFrame: {
    height: 36,
    width: 36,
  },
  avatarRing: {
    borderRadius: 12,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  badge: {
    borderRadius: 9999,
    borderWidth: 1,
    overflow: "hidden",
    position: "absolute",
    right: -10,
    top: -6,
  },
  badgeGradient: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
    minHeight: 16,
    minWidth: 16,
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 9,
    fontWeight: "normal",
  },
  bar: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  centerOverlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  iconBtn: {
    alignItems: "center",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  loginPill: {
    borderRadius: 9999,
  },
  loginPillGradient: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  loginPillText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
  },
  logo: {
    height: 36,
    width: 48,
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  sideLeft: {
    alignItems: "center",
    flexDirection: "row",
    width: 40,
    zIndex: 1,
  },
  sideRight: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginLeft: "auto",
    zIndex: 1,
  },
  sideRightGuest: {
    flexShrink: 0,
  },
  sideRightUser: {
    width: 88,
  },
});
