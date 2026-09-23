// 1:1 native port of web MobileBottomNav
// (components/layouts/navigation/mobile/mobile-bottom-nav). Floating
// centered dock: three icon-only 40px tabs a side split by the 52px orange
// compose circle that breaks the pill's edges, panel-3d surface, active
// tabs in the sidebar's pill-nav-active treatment, unread badge on
// Messages, and a scroll-down hide that slides the dock below the fold.
//
// Wiring notes: active state reads expo-router's pathname (only "/" exists
// on mobile yet, so Home is the live tab); auth-gated tabs send guests to
// login like web's goToLogin; destinations with no mobile screen yet render
// as disabled stubs, and the composer is stubbed until the composer lands
// (same "coming soon" language as the feed's Respond button). The hide
// signal is the shared feed scroll store, so the dock moves in lockstep
// with the top bar. The pending-navigation spinner has no expo-router
// equivalent (navigation is instant), so tabs always show their icon.
import { LinearGradient } from "expo-linear-gradient";
import { usePathname, useRouter } from "expo-router";
import {
  Clapperboard,
  Compass,
  Home,
  MessagesSquare,
  Newspaper,
  Users,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Path, Svg } from "react-native-svg";

import { useSessionContext } from "@/features/auth/state/session";
import { subscribeHeaderVisibility } from "@/features/feed/lib/header-visibility";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

interface MobileNavItem {
  href: string;
  icon: ComponentType<{ color?: string; size?: number }>;
  label: string;
  requiresAuth?: boolean;
}

// Three destinations a side, split by the centre compose action. Bookmarks
// and Settings are intentionally absent - both live in the mobile profile
// menu in the top bar, exactly like web.
const LEFT_ITEMS: MobileNavItem[] = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/gusts", icon: Clapperboard, label: "Gusts" },
  { href: "/discover", icon: Compass, label: "Explore" },
];

const RIGHT_ITEMS: MobileNavItem[] = [
  {
    href: "/messages",
    icon: MessagesSquare,
    label: "Messages",
    requiresAuth: true,
  },
  { href: "/communities", icon: Users, label: "Communities" },
  {
    href: "/hackernews",
    icon: Newspaper,
    label: "HackerNews",
    requiresAuth: true,
  },
];

// Routes with a mobile screen behind them. Everything else renders as a
// disabled stub until its screen lands - no dead-feeling fake navigation.
const LIVE_ROUTES = new Set(["/"]);

// Desktop sidebar's `.pill-nav-active`: tonal primary tint, hairline
// primary border and the inner lip, never a saturated fill. Primary is
// hsl(22.93 92.59% 52.35%) ~= #f66b15.
const NAV_ACTIVE = "#f66b15";
const NAV_ACTIVE_TINT = "rgba(246, 107, 21, 0.14)";
const NAV_ACTIVE_TINT_DEEP = "rgba(246, 107, 21, 0.08)";
const NAV_ACTIVE_BORDER = "rgba(246, 107, 21, 0.25)";
const NAV_ACTIVE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.45), inset 0 1px 2px rgba(255, 255, 255, 0.5), inset 0 -1px 2px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)";

// Centre compose action: web's `.follow-btn-3d`, light + dark.
const FOLLOW_BTN_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1.5px 2px rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(170, 60, 0, 0.45), 0 1px 1px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.1)";
const FOLLOW_BTN_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

const UNREAD_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 1px 2px rgba(0, 0, 0, 0.2)";

// A filled plus, not lucide's stroke-only Plus: the centre action is the one
// solid glyph in the dock, so it is a real filled path.
function FilledPlus() {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path d="M14 4h-4v6H4v4h6v6h4v-6h6v-4h-6z" fill="#ffffff" />
    </Svg>
  );
}

function DockTab({
  active,
  badge,
  disabled,
  icon: Icon,
  label,
  onPress,
}: {
  active: boolean;
  badge?: number;
  disabled?: boolean;
  icon: MobileNavItem["icon"];
  label: string;
  onPress?: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled ?? false, selected: active }}
      disabled={disabled}
      hitSlop={2}
      onPress={onPress}
      style={styles.tab}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.tabInner,
            active
              ? {
                  borderColor: NAV_ACTIVE_BORDER,
                  borderWidth: 1,
                  boxShadow: NAV_ACTIVE_SHADOWS,
                }
              : undefined,
            !active && pressed && !disabled
              ? { backgroundColor: theme.containerBg }
              : undefined,
            disabled && styles.tabDisabled,
          ]}
        >
          {active ? (
            <LinearGradient
              colors={[NAV_ACTIVE_TINT, NAV_ACTIVE_TINT_DEEP]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={styles.tabTint}
            />
          ) : null}
          <Icon color={active ? NAV_ACTIVE : theme.dividerText} size={20} />
          {badge !== undefined && badge > 0 ? (
            <View style={[styles.badge, { borderColor: theme.containerBg }]}>
              <LinearGradient
                colors={["#ff9500", "#e65500"]}
                end={{ x: 0.5, y: 1 }}
                start={{ x: 0.5, y: 0 }}
                style={[styles.badgeGradient, { boxShadow: UNREAD_SHADOWS }]}
              >
                <Text style={styles.badgeText}>
                  {badge > 99 ? "99+" : badge}
                </Text>
              </LinearGradient>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

export function MobileBottomNav({
  bottomOffset = 0,
  hidden: hiddenOverride,
  unreadCount = 0,
}: {
  // Extra lift above the bottom edge (the guest auth bar's height when it
  // is showing), so the floating dock never covers it.
  bottomOffset?: number;
  // A screen with its own scroll container may pass the same hide signal
  // that drives its top bar, like web's hiddenOverride.
  hidden?: boolean;
  unreadCount?: number;
}) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user } = useSessionContext();
  const isLoggedIn = Boolean(user);
  const [scrollHidden, setScrollHidden] = useState(false);
  const [dockHeight, setDockHeight] = useState(56);
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(
    () => subscribeHeaderVisibility((isHidden) => setScrollHidden(isHidden)),
    []
  );

  const hidden = hiddenOverride ?? scrollHidden;

  useEffect(() => {
    const travel = Animated.timing(slide, {
      duration: 240,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      toValue: hidden ? 1 : 0,
      useNativeDriver: true,
    });
    travel.start();
    return () => {
      travel.stop();
    };
  }, [hidden, slide]);

  const goToLogin = () => {
    router.push("/(auth)/login");
  };

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/?");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderTab = (item: MobileNavItem) => {
    const live = LIVE_ROUTES.has(item.href);
    if (item.requiresAuth && !isLoggedIn) {
      return (
        <DockTab
          active={false}
          badge={item.href === "/messages" ? unreadCount : undefined}
          icon={item.icon}
          key={item.href}
          label={item.label}
          onPress={goToLogin}
        />
      );
    }
    if (!live) {
      return (
        <DockTab
          active={false}
          disabled
          icon={item.icon}
          key={item.href}
          label={item.label}
        />
      );
    }
    return (
      <DockTab
        active={isActive(item.href)}
        badge={item.href === "/messages" ? unreadCount : undefined}
        icon={item.icon}
        key={item.href}
        label={item.label}
        onPress={() => router.push(item.href as "/")}
      />
    );
  };

  const handleCompose = () => {
    if (!isLoggedIn) {
      goToLogin();
    }
    // Signed-in compose is stubbed until the composer lands (same
    // "coming soon" language as the feed's Respond button).
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom: bottomOffset + insets.bottom + 12 }]}
    >
      <Animated.View
        onLayout={(event) => {
          setDockHeight(event.nativeEvent.layout.height);
        }}
        style={{
          opacity: slide.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0],
          }),
          transform: [
            {
              translateY: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [0, dockHeight + 16],
              }),
            },
          ],
        }}
      >
        <View
          style={[
            styles.panel,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
            },
          ]}
        >
          <View style={styles.side}>{LEFT_ITEMS.map(renderTab)}</View>
          <Pressable
            accessibilityLabel="Create Post"
            accessibilityRole="button"
            hitSlop={6}
            onPress={handleCompose}
            style={styles.composeWrap}
          >
            {({ pressed }) => (
              <LinearGradient
                colors={["#ff9500", "#e65500"]}
                end={{ x: 0.5, y: 1 }}
                start={{ x: 0.5, y: 0 }}
                style={[
                  styles.compose,
                  {
                    boxShadow: isDark
                      ? FOLLOW_BTN_SHADOWS_DARK
                      : FOLLOW_BTN_SHADOWS,
                  },
                  pressed && styles.pressedShift,
                ]}
              >
                <FilledPlus />
              </LinearGradient>
            )}
          </Pressable>
          <View style={styles.side}>{RIGHT_ITEMS.map(renderTab)}</View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 9999,
    borderWidth: 1,
    overflow: "hidden",
    position: "absolute",
    right: -2,
    top: -2,
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
  compose: {
    alignItems: "center",
    borderRadius: 9999,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  composeWrap: {
    marginVertical: -6,
  },
  dock: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 50,
  },
  panel: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    padding: 4,
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  side: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  tab: {
    borderRadius: 12,
    height: 40,
    width: 40,
  },
  tabDisabled: {
    opacity: 0.4,
  },
  tabInner: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  tabTint: {
    borderRadius: 12,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
