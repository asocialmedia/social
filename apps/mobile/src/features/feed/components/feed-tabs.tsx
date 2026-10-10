// Home feed tab strip: For you / Latest / Trending / Following with the
// sliding orange indicator from web's AnimatedTabTrigger (shared layoutId,
// spring between tabs). The indicator is measured per trigger and animated
// with the core Animated API: bar sits bottom-center under the active label
// (h-1 w-6 rounded-full, orange gradient), labels are inactive-muted and
// active semibold-ink.
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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

export function FeedTabs<T extends string = HomeTab>({
  active,
  fill = false,
  onChange,
  scrollable = false,
  renderLabel,
  onPressActive = false,
  tabs = HOME_TAB_DEFS as unknown as readonly FeedTabDef<T>[],
}: FeedTabsProps<T>) {
  const { theme } = useAppTheme();
  const [layouts, setLayouts] = useState<Record<string, TriggerLayout>>({});
  const indicatorX = useMemo(() => new Animated.Value(0), []);
  // First placement is the mount, not a tab switch: set without animating
  // so the bar never slides in from the left edge.
  const firstPlaced = useRef(true);
  const scrollRef = useRef<ScrollView>(null);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === active)
  );
  const activeDef = tabs[activeIndex];
  const layout = activeDef ? layouts[activeDef.value] : undefined;

  useEffect(() => {
    if (!layout) {
      return;
    }
    // Center the 24px bar under the active label, like web's justify-center.
    const left = layout.x + (layout.width - 24) / 2;
    if (firstPlaced.current) {
      firstPlaced.current = false;
      indicatorX.setValue(left);
    } else {
      Animated.timing(indicatorX, {
        duration: 220,
        toValue: left,
        useNativeDriver: Platform.OS !== "web",
      }).start();
    }

    // Scroll to reveal the active tab when scrollable is active.
    if (scrollable && scrollRef.current) {
      const targetX = Math.max(0, layout.x - 48);
      scrollRef.current.scrollTo({ animated: true, x: targetX });
    }
  }, [indicatorX, layout, scrollable]);

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
      {layout ? (
        <Animated.View
          style={[
            styles.indicator,
            { pointerEvents: "none", transform: [{ translateX: indicatorX }] },
          ]}
        >
          <LinearGradient
            colors={["#ff9500", "#e65500"]}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={styles.indicatorBar}
          />
        </Animated.View>
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
