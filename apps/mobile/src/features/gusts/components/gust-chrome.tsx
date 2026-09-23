// The reel's page chrome from web's client-gusts.tsx, phone layout: the
// Latest / For you tabs with the sliding orange underline (spring 420/34),
// the new-gusts pill (rail glass, up to three avatars, "N new gust(s)",
// ArrowUp), the pull-to-refresh spinner (a rail button whose loader turns
// with the pull and spins while refreshing), and the empty / error states.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowUp, Loader2, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import type { LayoutRectangle } from "react-native";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import noMediaImage from "@/assets/images/nomedia.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { RAIL_BUTTON, themeText } from "@/components/surface/recipes";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { resolveProfileImageUrl } from "@/features/home/components/profile-utils";
import {
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  useAppTheme,
} from "@/theme";

import type { GustTab } from "../lib/gusts-api";
import { RailButton } from "./rail-button";

const PRIMARY = "#f66b15";
const TABS: readonly { label: string; value: GustTab }[] = [
  { label: "Latest", value: "latest" },
  { label: "For you", value: "personalized" },
];
const UNDERLINE_WIDTH = 24;

export function GustTabs({
  active,
  onChange,
}: {
  active: GustTab;
  onChange: (tab: GustTab) => void;
}) {
  const [layouts, setLayouts] = useState<
    Partial<Record<GustTab, LayoutRectangle>>
  >({});
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [slide] = useState(() => new Animated.Value(0));
  const [placed, setPlaced] = useState(false);
  const target = layouts[active];

  useEffect(() => {
    if (!target) {
      return;
    }
    const x = target.x + target.width / 2 - UNDERLINE_WIDTH / 2;
    if (!placed) {
      slide.setValue(x);
      // oxlint-disable-next-line react/set-state-in-effect -- the first measured layout places the underline without animating
      setPlaced(true);
      return;
    }
    const spring = Animated.spring(slide, {
      damping: 34,
      mass: 1,
      stiffness: 420,
      toValue: x,
      useNativeDriver: true,
    });
    spring.start();
    return () => spring.stop();
  }, [placed, slide, target]);

  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {TABS.map((tab) => {
        const selected = tab.value === active;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.value}
            onLayout={(event) => {
              const { layout } = event.nativeEvent;
              setLayouts((current) => ({ ...current, [tab.value]: layout }));
            }}
            onPress={() => onChange(tab.value)}
            style={styles.tab}
          >
            <Text
              style={[
                styles.tabText,
                selected ? styles.tabTextActive : styles.tabTextIdle,
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
      {placed ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.underline, { transform: [{ translateX: slide }] }]}
        >
          <LinearGradient
            colors={["#ff9500", "#e65500"]}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={styles.underlineFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

export function NewGustsPill({
  apiBase,
  items,
  onPress,
}: {
  apiBase: string;
  items: readonly FeedPost[];
  onPress: () => void;
}) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const spring = Animated.spring(enter, {
      damping: 20,
      stiffness: 260,
      toValue: 1,
      useNativeDriver: true,
    });
    spring.start();
    return () => spring.stop();
  }, [enter]);
  const count = items.length;
  const label = count === 1 ? "1 new gust" : `${count} new gusts`;
  const authors: NonNullable<FeedPost["user"]>[] = [];
  for (const item of items) {
    const author = item.user;
    if (author && !authors.some((entry) => entry.id === author.id)) {
      authors.push(author);
    }
  }
  return (
    <Animated.View
      style={[
        styles.pillFloat,
        {
          opacity: enter,
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [-12, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityLabel={`Show ${label}`}
        accessibilityRole="button"
        onPress={onPress}
      >
        {({ pressed }) => (
          <View style={[styles.pill, pressed && styles.pillPressed]}>
            <View style={styles.stack}>
              {authors.slice(0, 3).map((author, index) => {
                const uri = author.avatarUrl
                  ? resolveProfileImageUrl(author.avatarUrl, apiBase)
                  : null;
                return (
                  <Image
                    contentFit="cover"
                    key={author.id}
                    source={uri ? { uri } : avatarPlaceholder}
                    style={[
                      styles.stackAvatar,
                      index === 0 && styles.stackFirst,
                    ]}
                  />
                );
              })}
            </View>
            <Text style={styles.pillText}>{label}</Text>
            <ArrowUp color={RAIL_BUTTON.color} size={16} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function SpinningLoader({ size }: { size: number }) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, {
        duration: 1000,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);
  return (
    <Animated.View
      style={{
        transform: [
          {
            rotate: turn.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "360deg"],
            }),
          },
        ],
      }}
    >
      <Loader2 color={PRIMARY} size={size} />
    </Animated.View>
  );
}

// Web's pull indicator: grows to the pull distance under the tabs, with a
// rail button whose loader turns pull x 2 degrees, or spins while the
// refresh runs.
export function PullIndicator({
  distance,
  refreshing,
  top,
}: {
  distance: number;
  refreshing: boolean;
  top: number;
}) {
  const height = refreshing ? Math.max(distance, 56) : distance;
  if (height <= 0) {
    return null;
  }
  return (
    <View pointerEvents="none" style={[styles.pull, { height, top }]}>
      <RailButton accessibilityLabel="Refreshing gusts" size={40}>
        {refreshing ? (
          <SpinningLoader size={20} />
        ) : (
          <View style={{ transform: [{ rotate: `${distance * 2}deg` }] }}>
            <Loader2 color={PRIMARY} size={20} />
          </View>
        )}
      </RailButton>
    </View>
  );
}

export function PagingSpinner() {
  return (
    <View pointerEvents="none" style={styles.paging}>
      <SpinningLoader size={24} />
    </View>
  );
}

// Web's "No Gusts yet" block (and, native-only, the same block for a load
// that failed after its retries, with a Try again action).
export function GustsEmpty({
  mode,
  onAction,
}: {
  mode: "empty" | "error";
  onAction: () => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const copy =
    mode === "empty"
      ? {
          action: "Create the First Gust",
          body: "Be the first to share a high-energy short-form video clip with the community!",
          title: "No Gusts yet",
        }
      : {
          action: "Try again",
          body: "Gusts hit a snag loading. Check your connection and try again.",
          title: "Gusts hit a snag",
        };
  return (
    <View style={styles.empty}>
      <Image
        accessibilityLabel=""
        contentFit="cover"
        source={noMediaImage}
        style={styles.emptyArt}
      />
      <Text style={[styles.emptyTitle, { color: text.foreground }]}>
        {copy.title}
      </Text>
      <Text style={[styles.emptyBody, { color: text.muted }]}>{copy.body}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onAction}
        style={styles.emptyAction}
      >
        {({ pressed }) => {
          let shadows = isDark
            ? LOGIN_BUTTON_SHADOWS
            : LOGIN_BUTTON_SHADOWS_LIGHT;
          if (pressed) {
            shadows = isDark
              ? LOGIN_BUTTON_PRESSED_SHADOWS
              : LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT;
          }
          return (
            <Gradient3D
              colors={pressed ? ["#e65500", "#d44a00"] : ["#ff9500", "#e65500"]}
              radius={8}
              shadows={shadows}
              style={[styles.emptyButton, pressed && styles.pressed]}
            >
              {mode === "empty" ? <Plus color="#ffffff" size={16} /> : null}
              <Text style={styles.emptyButtonText}>{copy.action}</Text>
            </Gradient3D>
          );
        }}
      </Pressable>
    </View>
  );
}

const TAB_SHADOW = {
  textShadowColor: "rgba(0, 0, 0, 0.6)",
  textShadowOffset: { height: 1, width: 0 },
  textShadowRadius: 4,
} as const;

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyAction: {
    marginTop: 20,
  },
  emptyArt: {
    borderRadius: 9999,
    height: 128,
    marginBottom: 16,
    opacity: 0.8,
    width: 128,
  },
  emptyBody: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    marginTop: 4,
    maxWidth: 384,
    textAlign: "center",
  },
  emptyButton: {
    flexDirection: "row",
    gap: 8,
    height: 40,
    paddingHorizontal: 16,
  },
  emptyButtonText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  emptyTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 20,
    fontWeight: "normal",
  },
  paging: {
    alignItems: "center",
    bottom: 40,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 30,
  },
  pill: {
    alignItems: "center",
    backgroundColor: RAIL_BUTTON.background,
    borderRadius: 9999,
    boxShadow: RAIL_BUTTON.shadows,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillFloat: {
    alignItems: "center",
  },
  pillPressed: {
    transform: [{ scale: 0.95 }],
  },
  pillText: {
    color: RAIL_BUTTON.color,
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  pull: {
    alignItems: "center",
    justifyContent: "flex-start",
    left: 0,
    overflow: "hidden",
    paddingTop: 4,
    position: "absolute",
    right: 0,
    zIndex: 20,
  },
  stack: {
    flexDirection: "row",
  },
  stackAvatar: {
    borderColor: "#171717",
    borderRadius: 9999,
    borderWidth: 2,
    height: 24,
    marginLeft: -8,
    width: 24,
  },
  stackFirst: {
    marginLeft: 0,
  },
  tab: {
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  tabText: {
    ...TAB_SHADOW,
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "normal",
  },
  tabTextActive: {
    fontFamily: "SofiaProBold",
  },
  tabTextIdle: {
    color: "rgba(255, 255, 255, 0.7)",
    fontFamily: "SofiaProMed",
  },
  tabs: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  underline: {
    bottom: 2,
    height: 4,
    left: 0,
    position: "absolute",
    width: UNDERLINE_WIDTH,
  },
  underlineFill: {
    borderRadius: 9999,
    flex: 1,
  },
});
