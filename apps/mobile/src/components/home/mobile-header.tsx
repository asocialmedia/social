// 1:1 native port of web MobileTopBar
// (components/layouts/navigation/mobile/mobile-top-bar.tsx).
// Left: avatar (signed in) or spacer (guest). Center: asm logo pinned to the
// bar's centerline, linking home. Right: notification bell with unread badge
// + search (signed in) or a premium Log in pill (guest). UI-only: session,
// unread count, and search are props; no API calls.

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Bell, Search } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import asmLogo from "@/assets/images/asm.png";
import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import {
  ICON_BUTTON_SHADOWS_DARK,
  ICON_BUTTON_SHADOWS_LIGHT,
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_SHADOWS,
  useAppTheme,
} from "@/theme";

interface MobileHeaderProps {
  onSearchPress?: () => void;
  unreadCount?: number;
  user?: { avatarUrl?: string | null; username: string } | null;
}

export function MobileHeader({
  onSearchPress,
  unreadCount = 0,
  user = null,
}: MobileHeaderProps) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const iconShadows = isDark
    ? ICON_BUTTON_SHADOWS_DARK
    : ICON_BUTTON_SHADOWS_LIGHT;

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
            <Pressable hitSlop={6} onPress={() => router.push("/")}>
              <Image
                contentFit="cover"
                source={
                  user.avatarUrl ? { uri: user.avatarUrl } : avatarPlaceholder
                }
                style={styles.avatar}
              />
            </Pressable>
          ) : null}
        </View>

        {/* Pinned to the bar's own centerline, like web's absolute centering. */}
        <Pressable
          hitSlop={6}
          onPress={() => router.push("/")}
          style={styles.logoHit}
        >
          <Image
            accessibilityLabel="asocialmedia"
            contentFit="contain"
            source={asmLogo}
            style={styles.logo}
          />
        </Pressable>

        <View style={[styles.sideRight, { width: user ? 88 : 40 }]}>
          {user ? (
            <>
              <Pressable hitSlop={6} onPress={() => router.push("/")}>
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
                      <View style={styles.badge}>
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
              <Pressable hitSlop={6} onPress={onSearchPress}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: 9999,
    height: 40,
    width: 40,
  },
  badge: {
    borderRadius: 9999,
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: "relative",
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
  logoHit: {
    left: "50%",
    position: "absolute",
    transform: [{ translateX: -24 }],
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  sideLeft: {
    alignItems: "center",
    flexDirection: "row",
    width: 40,
  },
  sideRight: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginLeft: "auto",
  },
});
