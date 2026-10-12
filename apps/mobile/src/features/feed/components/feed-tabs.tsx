// Place the orange indicator from the same measured layout as its label.
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { haptic } from "@/lib/haptics";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import type { HomeTab } from "../state/tab-store";

export interface FeedTabDef<T extends string = HomeTab> {
  label: string;
  value: T;
}

export const HOME_TAB_DEFS: readonly FeedTabDef[] = [
  { label: "For you", value: "personalized" },
  { label: "Latest", value: "latest" },
  { label: "Trending", value: "trending" },
  { label: "Following", value: "following" },
];

interface FeedTabsProps<T extends string = HomeTab> {
  active: T;
  // Two-tab surfaces (notifications) stretch each trigger to half the width,
  // matching web's flex-1 tab buttons; the feed strip stays content-centered.
  fill?: boolean;
  indicatorLabelLayout?: (
    tab: FeedTabDef<T>
  ) => TriggerLayout | null | undefined;
  indicatorWidth?: (tab: FeedTabDef<T>, triggerWidth: number) => number;
  onChange: (tab: T) => void;
  scrollable?: boolean;
  renderLabel?: (tab: FeedTabDef<T>, selected: boolean) => ReactNode;
  onPressActive?: boolean;
  tabs?: readonly FeedTabDef<T>[];
}

interface TriggerLayout {
  width: number;
  x: number;
}

function FeedTabIndicator({ x, width }: { x: number; width: number }) {
  const indicatorX = useSharedValue(x);
  const indicatorWidth = useSharedValue(width);
  useEffect(() => {
    indicatorX.set(withTiming(x, { duration: 180 }));
    indicatorWidth.set(withTiming(width, { duration: 180 }));
  }, [indicatorWidth, indicatorX, width, x]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.get() }],
    width: indicatorWidth.get(),
  }));
  return (
    <Animated.View
      testID="feed-tab-indicator"
      pointerEvents="none"
      style={[styles.indicator, animatedStyle]}
    >
      <LinearGradient
        colors={["#ff9500", "#e65500"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={styles.indicatorBar}
      />
    </Animated.View>
  );
}

export function FeedTabs<T extends string = HomeTab>({
  active,
  fill = false,
  indicatorLabelLayout,
  indicatorWidth,
  onChange,
  scrollable = false,
  renderLabel,
  onPressActive = false,
  tabs = HOME_TAB_DEFS as unknown as readonly FeedTabDef<T>[],
}: FeedTabsProps<T>) {
  const { theme } = useAppTheme();
  const [layouts, setLayouts] = useState<Record<string, TriggerLayout>>({});
  const scrollRef = useRef<ScrollView>(null);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === active)
  );
  const activeDef = tabs[activeIndex];
  const layout = activeDef ? layouts[activeDef.value] : undefined;
  const labelLayout = activeDef ? indicatorLabelLayout?.(activeDef) : undefined;
  const labelWidth = labelLayout?.width ?? layout?.width ?? 0;
  const barWidth =
    layout && activeDef ? (indicatorWidth?.(activeDef, labelWidth) ?? 24) : 24;
  const targetX =
    (layout?.x ?? 0) + (labelLayout?.x ?? 0) + (labelWidth - barWidth) / 2;

  useEffect(() => {
    if (!layout) {
      return;
    }
    // Scroll to reveal the active tab when scrollable is active.
    if (scrollable && scrollRef.current) {
      const scrollTargetX = Math.max(0, layout.x - 48);
      scrollRef.current.scrollTo({ animated: true, x: scrollTargetX });
    }
  }, [layout, scrollable]);

  const content = (
    <View
      style={[
        styles.stripInner,
        scrollable ? styles.stripScrollableInner : null,
        fill ? styles.stripFill : null,
      ]}
    >
      {tabs.map((tab) => {
        const selected = tab.value === active;
        return (
          <Pressable
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            hitSlop={4}
            key={tab.value}
            onLayout={(event) => {
              const { width, x } = event.nativeEvent.layout;
              setLayouts((current) =>
                current[tab.value]?.width === width &&
                current[tab.value]?.x === x
                  ? current
                  : { ...current, [tab.value]: { width, x } }
              );
            }}
            onPress={() => {
              if (!selected || onPressActive) {
                haptic();
                onChange(tab.value);
              }
            }}
            style={[
              styles.trigger,
              scrollable ? styles.scrollableTrigger : null,
              fill ? styles.triggerFill : null,
            ]}
          >
            {renderLabel ? (
              renderLabel(tab, selected)
            ) : (
              <Text
                style={[
                  styles.label,
                  {
                    color: selected ? theme.inputText : theme.dividerText,
                    fontFamily: selected ? "SofiaProBold" : "SofiaProMed",
                  },
                ]}
              >
                {tab.label}
              </Text>
            )}
          </Pressable>
        );
      })}
      {layout && layout.width > 0 && labelWidth > 0 && labelLayout !== null ? (
        <FeedTabIndicator x={targetX} width={barWidth} />
      ) : null}
    </View>
  );

  if (scrollable) {
    return (
      <View
        accessibilityRole="tablist"
        style={[
          styles.strip,
          {
            backgroundColor: theme.containerBg,
            borderBottomColor: theme.cardBorder,
          },
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          horizontal
          ref={scrollRef}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
        >
          {content}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.strip,
        fill ? styles.stripFill : null,
        {
          backgroundColor: theme.containerBg,
          borderBottomColor: theme.cardBorder,
        },
      ]}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    bottom: 0,
    height: 4,
    left: 0,
    position: "absolute",
    width: 24,
  },
  indicatorBar: {
    borderRadius: 9999,
    height: 4,
    width: "100%",
  },
  label: {
    fontSize: 14,
    fontWeight: "normal",
  },
  scrollContent: {
    alignItems: "center",
    flexDirection: "row",
  },
  scrollableTrigger: {
    paddingHorizontal: 12,
  },
  strip: {
    borderBottomWidth: 1,
    // The home composer collapses upward under this strip when the feed
    // scrolls down, and the feed is a later sibling, so the strip is lifted
    // above it and filled with the page background to hide the composer
    // passing behind. zIndex only, never elevation: on Android elevation
    // would draw a drop shadow along the strip's bottom border.
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 6,
    position: "relative",
    zIndex: 10,
  },
  stripFill: {
    justifyContent: "space-between",
  },
  stripInner: {
    flexDirection: "row",
    justifyContent: "center",
    position: "relative",
    width: "100%",
  },
  stripScrollableInner: {
    flexDirection: "row",
    paddingHorizontal: 8,
    position: "relative",
    width: "auto",
  },
  trigger: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  triggerFill: {
    flex: 1,
  },
});
