import type { GustFollowingAvatar } from "@asm/ui/lib/gust-header";
import type { LucideProps } from "lucide-react-native";
import { ChevronDown, Clock3, Sparkles } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type { MenuAnchor } from "@/features/feed/components/more-menu";
import { haptic } from "@/lib/haptics";

import type { GustTab } from "../lib/gusts-api";

function FilledSparkles(props: LucideProps) {
  return <Sparkles {...props} fill={props.color ?? "currentColor"} />;
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
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const visibleAvatars = avatars.slice(0, width < 360 ? 2 : 3);
  const [discovery, setDiscovery] = useState<"latest" | "personalized">(
    active === "latest" ? "latest" : "personalized"
  );
  const selectedDiscovery = active === "following" ? discovery : active;
  const alternative =
    selectedDiscovery === "latest" ? "personalized" : "latest";
  const label = selectedDiscovery === "latest" ? "Latest" : "For you";
  return (
    <View style={styles.row} testID="gust-feed-controls">
      <Pressable
        accessibilityLabel={`${label}, choose Gusts feed`}
        accessibilityRole="button"
        accessibilityState={{ expanded: anchor !== null }}
        onPress={() => {
          haptic("selection");
          trigger.current?.measureInWindow((x, y, triggerWidth, height) => {
            setAnchor({ height, width: triggerWidth, x, y });
          });
        }}
        ref={trigger}
        style={styles.control}
      >
        <Text style={[styles.text, active === "following" && styles.idle]}>
          {label}
        </Text>
        <ChevronDown
          color={active === "following" ? "#bbbbbb" : "#ffffff"}
          size={15}
        />
        {active === "following" ? null : <View style={styles.underline} />}
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
        style={styles.control}
      >
        <View style={styles.followingLabel} testID="gust-following-label">
          <Text style={[styles.text, active !== "following" && styles.idle]}>
            Following
          </Text>
          {active === "following" ? (
            <View
              style={[styles.underline, styles.followingUnderline]}
              testID="gust-following-underline"
            />
          ) : null}
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
  followingUnderline: { marginLeft: -24, width: 48 },
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
    left: "50%",
    marginLeft: -12,
    position: "absolute",
    width: 24,
  },
});
