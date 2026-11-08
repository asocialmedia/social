// 1:1 native port of web MobileUserMenu
// (components/layouts/navigation/mobile/mobile-user-menu.tsx), which is what
// the web mobile user button opens. Same order, same copy: a dimmed blurred
// backdrop, a centered panel-3d card (max-w-md, p-4, pt-20 offset), an X
// close affordance, the glowing 100px avatar linking to the profile, the
// display name, @handle or email, the quoted bio, Profile and Settings rows,
// the Light/Dark/System theme grid, and the red Log out row opening web's
// confirm dialog. Anything the web menu does not show (banner, stats,
// bookmarks row, history link, socials) is gone.
//
// Identity rides the session plus the popup profile cache (profile-cache.ts,
// web's 5-minute staleTime), so the menu opens instantly on session fields
// and upgrades to the profile's display name, handle and bio when ready.
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  LogOut,
  Monitor,
  Moon,
  Quote,
  Settings2,
  Sun,
  User as UserIcon,
  X,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { panel3d } from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";
import { useThemePreference } from "@/theme/theme-preference-native";

import { LogoutDialog } from "./logout-dialog";
import { popupCache } from "./profile-cache";
import { resolveProfileImageUrl } from "./profile-utils";
import { usePopupProfile } from "./use-popup-profile";

// Web's orange primary (both themes) and the red-500 logout tones.
const PRIMARY = "#f97316";
const ACTIVE_OPTION_BG = "rgba(249, 115, 22, 0.2)";
const PRESSED_WASH = "rgba(249, 115, 22, 0.1)";
const LOGOUT_BORDER = "rgba(239, 68, 68, 0.2)";
const LOGOUT_BG = "rgba(239, 68, 68, 0.1)";
const LOGOUT_PRESSED_BG = "rgba(239, 68, 68, 0.2)";
const LOGOUT_TEXT = "#ef4444";
// Web's from-primary/20 via-primary/30 to-primary/20 avatar glow.
const GLOW_GRADIENT = [
  "rgba(249, 115, 22, 0.2)",
  "rgba(249, 115, 22, 0.3)",
  "rgba(249, 115, 22, 0.2)",
] as const;

interface MobileUserMenuProps {
  onClose: () => void;
  userId: string | null;
}

function ThemeOption({
  active,
  Icon,
  label,
  onPress,
}: {
  active: boolean;
  Icon: ComponentType<{ color?: string; size?: number }>;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const tint = active ? PRIMARY : theme.dividerText;
  return (
    <Pressable
      accessibilityLabel={`${label} theme`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.themeOption,
        active && { backgroundColor: ACTIVE_OPTION_BG },
      ]}
    >
      <Icon color={tint} size={20} />
      <Text style={[styles.themeOptionLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

function MenuRow({
  Icon,
  label,
  onPress,
}: {
  Icon: ComponentType<{ color?: string; size?: number }>;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        { borderColor: theme.cardBorder },
        pressed && { backgroundColor: PRESSED_WASH },
      ]}
    >
      <Icon color={theme.inputText} size={20} />
      <Text style={[styles.menuRowLabel, { color: theme.inputText }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MobileUserMenu({ onClose, userId }: MobileUserMenuProps) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const { signOut, user } = useSessionContext();
  const { state } = usePopupProfile(userId);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Web's menuVariants: hidden {opacity 0, scale .95, y 20} -> visible
  // {opacity 1, scale 1, y 0, spring stiffness 300 damping 30} -> exit 0.2s.
  const backdropOpacity = useSharedValue(0);
  const panelOpacity = useSharedValue(0);
  const panelScale = useSharedValue(0.95);
  const panelY = useSharedValue(20);
  useEffect(() => {
    if (!userId) {
      return;
    }
    // oxlint-disable-next-line react/set-state-in-effect -- a newly opened menu replays the enter motion by design
    setClosing(false);
    backdropOpacity.set(withTiming(1, { duration: 200 }));
    panelOpacity.set(withTiming(1, { duration: 200 }));
    panelScale.set(withSpring(1, { damping: 30, stiffness: 300 }));
    panelY.set(withSpring(0, { damping: 30, stiffness: 300 }));
  }, [backdropOpacity, panelOpacity, panelScale, panelY, userId]);
  useEffect(
    () => () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
      }
    },
    []
  );

  const panel = panel3d(isDark);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get(),
  }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: panelOpacity.get(),
    transform: [{ scale: panelScale.get() }, { translateY: panelY.get() }],
  }));

  // X, backdrop and theme taps play the 0.2s exit before unmounting, like
  // web's AnimatePresence exit. Navigation unmounts immediately instead,
  // exactly as a route change unmounts the web menu mid-exit.
  const dismiss = () => {
    if (closing) {
      return;
    }
    setClosing(true);
    backdropOpacity.set(withTiming(0, { duration: 200 }));
    panelOpacity.set(withTiming(0, { duration: 200 }));
    panelScale.set(withTiming(0.95, { duration: 200 }));
    panelY.set(withTiming(20, { duration: 200 }));
    closeTimer.current = setTimeout(onClose, 210);
  };

  const profile = state.status === "ready" ? state.profile : null;
  const preference = useThemePreference((pref) => pref.preference);
  const setPreference = useThemePreference((pref) => pref.setPreference);

  if (userId === null && !closing) {
    return null;
  }

  const displayName = profile?.displayName || user?.name || "";
  const handle = profile?.username ?? user?.username ?? null;
  const emailLine = handle
    ? `@${handle}`
    : (user?.email ?? "No email provided");
  const apiBase = getApiBaseUrl();
  const avatarUri = profile
    ? resolveProfileImageUrl(profile.avatarUrl, apiBase)
    : null;
  const openProfile = () => {
    const name = profile?.username ?? user?.username ?? null;
    onClose();
    if (name) {
      router.push({
        params: { username: name },
        pathname: "/users/[username]",
      });
    }
  };
  const openSettings = () => {
    onClose();
    router.push("/settings");
  };
  const openLogoutDialog = () => {
    onClose();
    setLogoutOpen(true);
  };
  const closeLogout = () => setLogoutOpen(false);
  const confirmLogout = () => {
    // The next account must never see this one's cached popup.
    popupCache.clear();
    void signOut();
    setLogoutOpen(false);
    onClose();
  };

  return (
    <Modal
      animationType="none"
      onRequestClose={dismiss}
      statusBarTranslucent
      navigationBarTranslucent
      transparent
      visible
    >
      <View style={styles.root}>
        {/* Web's bg-background/90 backdrop: the page background at 90%. */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.containerBg },
            backdropStyle,
          ]}
        >
          <Pressable
            accessibilityLabel="Close user menu"
            accessibilityRole="button"
            onPress={dismiss}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.panel,
              {
                backgroundColor: panel.background,
                borderColor: panel.border,
                boxShadow: panel.shadows,
              },
              panelStyle,
            ]}
          >
            <Pressable
              accessibilityLabel="Close user menu"
              accessibilityRole="button"
              hitSlop={6}
              onPress={dismiss}
              style={styles.close}
            >
              <X color={theme.dividerText} size={24} />
            </Pressable>

            <View style={styles.identity}>
              <View style={styles.avatarWrap}>
                <LinearGradient
                  colors={[...GLOW_GRADIENT]}
                  end={{ x: 1, y: 0 }}
                  start={{ x: 0, y: 0 }}
                  style={styles.glow}
                />
                <Pressable
                  accessibilityLabel={
                    handle ? `Open @${handle}'s profile` : "Open profile"
                  }
                  accessibilityRole="link"
                  onPress={openProfile}
                >
                  <UserAvatar
                    size={100}
                    url={avatarUri}
                    userId={user?.id ?? null}
                    username={handle}
                  />
                  {/* Web's border-4 ring in the page background, so the
                      avatar lifts off the panel like UserAvatar's ring does. */}
                  <View
                    pointerEvents="none"
                    style={[
                      styles.avatarRing,
                      { borderColor: panel.background },
                    ]}
                  />
                </Pressable>
              </View>
              <View style={styles.nameBlock}>
                <Text
                  numberOfLines={2}
                  style={[styles.displayName, { color: theme.inputText }]}
                >
                  {displayName}
                </Text>
                <Text style={[styles.handle, { color: theme.dividerText }]}>
                  {emailLine}
                </Text>
              </View>
              {profile?.bio ? (
                <View style={styles.bioRow}>
                  <Quote color={theme.dividerText} size={16} />
                  <Text style={[styles.bio, { color: theme.dividerText }]}>
                    {profile.bio}
                  </Text>
                  <Quote color={theme.dividerText} size={16} />
                </View>
              ) : null}
            </View>

            <View style={styles.rows}>
              <MenuRow Icon={UserIcon} label="Profile" onPress={openProfile} />
              <MenuRow
                Icon={Settings2}
                label="Settings"
                onPress={openSettings}
              />
              <View
                style={[styles.themeBox, { borderColor: theme.cardBorder }]}
              >
                <View style={styles.themeHead}>
                  <Monitor color={theme.inputText} size={20} />
                  <Text style={[styles.themeTitle, { color: theme.inputText }]}>
                    Theme
                  </Text>
                </View>
                <View style={styles.themeGrid}>
                  {(
                    [
                      { Icon: Sun, label: "Light", value: "light" },
                      { Icon: Moon, label: "Dark", value: "dark" },
                      { Icon: Monitor, label: "System", value: "system" },
                    ] as const
                  ).map(({ Icon, label, value }) => (
                    <ThemeOption
                      active={preference === value}
                      Icon={Icon}
                      key={value}
                      label={label}
                      onPress={() => {
                        setPreference(value);
                        dismiss();
                      }}
                    />
                  ))}
                </View>
              </View>
              <Pressable
                accessibilityLabel="Log out"
                accessibilityRole="button"
                onPress={openLogoutDialog}
                style={({ pressed }) => [
                  styles.logout,
                  pressed && { backgroundColor: LOGOUT_PRESSED_BG },
                ]}
              >
                <LogOut color={LOGOUT_TEXT} size={20} />
                <Text style={[styles.logoutLabel, { color: LOGOUT_TEXT }]}>
                  Log out
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </View>

      <LogoutDialog
        onClose={closeLogout}
        onLogout={confirmLogout}
        open={logoutOpen}
      />
    </Modal>
  );
}

const AVATAR_GLOW = 132;

const styles = StyleSheet.create({
  avatarRing: {
    borderRadius: 34,
    borderWidth: 4,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  avatarWrap: {
    alignItems: "center",
    height: AVATAR_GLOW,
    justifyContent: "center",
    width: AVATAR_GLOW,
  },
  bio: {
    flexShrink: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontStyle: "italic",
    fontWeight: "normal",
    textAlign: "center",
  },
  bioRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    marginTop: 8,
    opacity: 0.6,
    paddingHorizontal: 8,
  },
  close: {
    borderRadius: 9999,
    padding: 8,
    position: "absolute",
    right: 16,
    top: 16,
    zIndex: 1,
  },
  displayName: {
    fontFamily: "SofiaProMed",
    fontSize: 18,
    fontWeight: "normal",
    textAlign: "center",
  },
  glow: {
    borderRadius: AVATAR_GLOW / 2,
    height: AVATAR_GLOW,
    opacity: 0.75,
    position: "absolute",
    width: AVATAR_GLOW,
  },
  handle: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    marginTop: 2,
    textAlign: "center",
  },
  identity: {
    alignItems: "center",
    marginTop: 16,
  },
  logout: {
    alignItems: "center",
    backgroundColor: LOGOUT_BG,
    borderColor: LOGOUT_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    padding: 12,
    width: "100%",
  },
  logoutLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 15,
    fontWeight: "normal",
  },
  menuRow: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 12,
  },
  menuRowLabel: {
    fontFamily: "SofiaProReg",
    fontSize: 15,
    fontWeight: "normal",
  },
  nameBlock: {
    marginTop: 12,
  },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 448,
    overflow: "hidden",
    padding: 16,
    position: "relative",
    width: "100%",
  },
  root: {
    flex: 1,
  },
  rows: {
    gap: 8,
    marginTop: 24,
  },
  scroll: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "flex-start",
    padding: 16,
    paddingTop: 80,
  },
  themeBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  themeGrid: {
    flexDirection: "row",
    gap: 8,
  },
  themeHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  themeOption: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    gap: 4,
    paddingVertical: 12,
  },
  themeOptionLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  themeTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
});
