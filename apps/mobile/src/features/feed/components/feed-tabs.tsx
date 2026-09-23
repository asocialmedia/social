// Home feed tab strip: For you / Latest / Trending / Following with the
// sliding orange indicator from web's AnimatedTabTrigger (shared layoutId,
// spring between tabs). The indicator is measured per trigger and animated
// with the core Animated API: bar sits bottom-center under the active label
// (h-1 w-6 rounded-full, orange gradient), labels are inactive-muted and
// active semibold-ink.
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

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
  tabs = HOME_TAB_DEFS as unknown as readonly FeedTabDef<T>[],
}: FeedTabsProps<T>) {
  const { theme } = useAppTheme();
  const [layouts, setLayouts] = useState<Record<string, TriggerLayout>>({});
  const indicatorX = useMemo(() => new Animated.Value(0), []);

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
    Animated.timing(indicatorX, {
      duration: 220,
      toValue: left,
      useNativeDriver: true,
    }).start();
  }, [indicatorX, layout]);

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.strip,
        fill ? styles.stripFill : null,
        { borderBottomColor: theme.cardBorder },
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
              if (!selected) {
                onChange(tab.value);
              }
            }}
            style={[styles.trigger, fill ? styles.triggerFill : null]}
          >
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
          </Pressable>
        );
      })}
      {layout ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            { transform: [{ translateX: indicatorX }] },
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
  strip: {
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 6,
    position: "relative",
  },
  stripFill: {
    justifyContent: "space-between",
  },
  trigger: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  triggerFill: {
    flex: 1,
  },
});
