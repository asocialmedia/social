import type { GustFollowingAvatar } from "@asm/ui/lib/gust-header";
import { gustFeedIndicator } from "@asm/ui/lib/gust-header";
import { discoveryFeedPress } from "@asm/ui/lib/home-feed-controls";
import type { LucideProps } from "lucide-react-native";
import { ChevronDown, Clock3, Sparkles } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import type { ViewInstance } from "react-native";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type { MenuAnchor } from "@/features/feed/components/more-menu";
import { haptic } from "@/lib/haptics";

import type { GustTab } from "../lib/gusts-api";

function FilledSparkles(props: LucideProps) {
  return <Sparkles {...props} fill={props.color ?? "currentColor"} />;
}

function GustFeedIndicator({ x, width }: { x: number; width: number }) {
  // Mount with measured coordinates so the initial animated style is already valid.
  const indicatorX = useSharedValue(x);
  const indicatorWidth = useSharedValue(width);
  useEffect(() => {
    indicatorX.set(withTiming(x, { duration: 220 }));
    indicatorWidth.set(withTiming(width, { duration: 220 }));
  }, [indicatorWidth, indicatorX, width, x]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.get() }],
    width: indicatorWidth.get(),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.underline, animatedStyle]}
      testID="gust-feed-indicator"
    />
  );
}

export function GustFeedControls({
  active,
  avatars,
  onChange,
}: {
  active: GustTab;
  avatars: readonly GustFollowingAvatar[];
  onChange: (tab: GustTab) => void;
}) {
  const { width } = useWindowDimensions();
  const trigger = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const visibleAvatars = avatars.slice(0, width < 360 ? 2 : 3);
  const [discovery, setDiscovery] = useState<"latest" | "personalized">(
    active === "latest" ? "latest" : "personalized"
  );
  const selectedDiscovery = active === "following" ? discovery : active;
  if (selectedDiscovery !== discovery) {
    setDiscovery(selectedDiscovery);
  }
  const alternative =
    selectedDiscovery === "latest" ? "personalized" : "latest";
  const label = selectedDiscovery === "latest" ? "Latest" : "For you";
  const [layouts, setLayouts] = useState<
    Partial<Record<"discovery" | "following", { x: number; width: number }>>
  >({});
  const [labelLayouts, setLabelLayouts] = useState<
    Partial<Record<"discovery" | "following", { x: number; width: number }>>
  >({});
  const following = active === "following";
  const target = layouts[following ? "following" : "discovery"];
  const labelLayout = labelLayouts[following ? "following" : "discovery"];
  const measuredLabel =
    target && labelLayout
      ? { width: labelLayout.width, x: target.x + labelLayout.x }
      : null;
  const { width: barWidth, x: targetX } = gustFeedIndicator(
    measuredLabel ?? { width: 0, x: 0 },
    following
  );
  return (
    <View style={styles.row} testID="gust-feed-controls">
      <Pressable
        accessibilityLabel={`${label}, choose Gusts feed`}
        accessibilityRole="button"
        accessibilityState={{
          expanded: anchor !== null,
          selected: active === selectedDiscovery,
        }}
        onPress={() => {
          haptic("selection");
          const action = discoveryFeedPress(active, selectedDiscovery);
          if (action.type === "navigate") {
            onChange(action.feed);
            return;
          }
          trigger.current?.measureInWindow((x, y, triggerWidth, height) => {
            setAnchor({ height, width: triggerWidth, x, y });
          });
        }}
        ref={trigger}
        onLayout={(event) => {
          const { x, width: controlWidth } = event.nativeEvent.layout;
          setLayouts((current) =>
            current.discovery?.x === x &&
            current.discovery.width === controlWidth
              ? current
              : { ...current, discovery: { width: controlWidth, x } }
          );
        }}
        style={styles.control}
      >
        <Text
          style={[styles.text, active === "following" && styles.idle]}
          testID="gust-discovery-label"
          onLayout={(event) => {
            const { x, width: labelWidth } = event.nativeEvent.layout;
            setLabelLayouts((current) =>
              current.discovery?.x === x &&
              current.discovery.width === labelWidth
                ? current
                : { ...current, discovery: { width: labelWidth, x } }
            );
          }}
        >
          {label}
        </Text>
        <ChevronDown
          color={active === "following" ? "#bbbbbb" : "#ffffff"}
          size={15}
        />
      </Pressable>
      <MoreMenu<{ type: "latest" | "personalized" }>
        align="start"
        anchor={anchor}
        entries={[
          {
            action: { type: alternative },
            icon: alternative === "latest" ? Clock3 : FilledSparkles,
            label: alternative === "latest" ? "Latest" : "For you",
          },
        ]}
        minWidth={128}
        onAction={({ type }) => {
          setDiscovery(type);
          onChange(type);
        }}
        onClose={() => setAnchor(null)}
      />
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: active === "following" }}
        accessibilityLabel="Following Gusts"
        onPress={() => onChange("following")}
        onLayout={(event) => {
          const { x, width: controlWidth } = event.nativeEvent.layout;
          setLayouts((current) =>
            current.following?.x === x &&
            current.following.width === controlWidth
              ? current
              : { ...current, following: { width: controlWidth, x } }
          );
        }}
        style={styles.control}
      >
        <View
          style={styles.followingLabel}
          testID="gust-following-label"
          onLayout={(event) => {
            const { x, width: labelWidth } = event.nativeEvent.layout;
            setLabelLayouts((current) =>
              current.following?.x === x &&
              current.following.width === labelWidth
                ? current
                : { ...current, following: { width: labelWidth, x } }
            );
          }}
        >
          <Text style={[styles.text, active !== "following" && styles.idle]}>
            Following
          </Text>
        </View>
        {visibleAvatars.length ? (
          <View style={styles.stack} pointerEvents="none">
            {visibleAvatars.map((person, index) => (
              <View
                key={person.id}
                testID={`gust-following-avatar-${person.id}`}
                style={[
                  styles.avatar,
                  {
                    marginLeft: index ? -10 : 0,
                    zIndex: visibleAvatars.length - index,
                  },
                ]}
              >
                <UserAvatar
                  radius={7}
                  seed={person.id}
                  size={24}
                  url={person.avatarUrl}
                />
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
      {measuredLabel ? (
        <GustFeedIndicator width={barWidth} x={targetX} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: 7,
    height: 24,
    width: 24,
  },
  control: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 9,
    position: "relative",
  },
  followingLabel: {
    justifyContent: "center",
    minHeight: 44,
    position: "relative",
  },
  idle: { color: "#bbbbbb", fontFamily: "SofiaProMed" },
  row: { alignItems: "center", flexDirection: "row", gap: 3 },
  stack: { flexDirection: "row", marginLeft: 2 },
  text: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 4,
  },
  underline: {
    backgroundColor: "#ff9500",
    borderRadius: 2,
    bottom: 2,
    height: 3,
    left: 0,
    position: "absolute",
    width: 24,
  },
});
