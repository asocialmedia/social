import type { GustFollowingAvatar } from "@asm/ui/lib/gust-header";
import { MenuView } from "@expo/ui/community/menu";
import { Image } from "expo-image";
import { ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { resolveProfileImageUrl } from "@/features/home/components/profile-utils";
import { haptic } from "@/lib/haptics";

import type { GustTab } from "../lib/gusts-api";

export function GustFeedControls({
  active,
  apiBase,
  avatars,
  onChange,
}: {
  active: GustTab;
  apiBase: string;
  avatars: readonly GustFollowingAvatar[];
  onChange: (tab: GustTab) => void;
}) {
  const [discovery, setDiscovery] = useState<"latest" | "personalized">(
    active === "latest" ? "latest" : "personalized"
  );
  const selectedDiscovery = active === "following" ? discovery : active;
  const label = selectedDiscovery === "latest" ? "Latest" : "For you";
  return (
    <View style={styles.row}>
      <MenuView
        actions={[
          {
            id: "personalized",
            state: selectedDiscovery === "personalized" ? "on" : "off",
            title: "For you",
          },
          {
            id: "latest",
            state: selectedDiscovery === "latest" ? "on" : "off",
            title: "Latest",
          },
        ]}
        colorScheme="dark"
        onOpenMenu={() => haptic("selection")}
        onPressAction={({ nativeEvent }) => {
          const next = nativeEvent.event;
          if (next === "latest" || next === "personalized") {
            setDiscovery(next);
            onChange(next);
          }
        }}
      >
        <View
          accessibilityLabel={`${label}, choose Gusts feed`}
          accessibilityRole="button"
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
        </View>
      </MenuView>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: active === "following" }}
        accessibilityLabel="Following Gusts"
        onPress={() => onChange("following")}
        style={styles.control}
      >
        <Text style={[styles.text, active !== "following" && styles.idle]}>
          Following
        </Text>
        {avatars.length ? (
          <View style={styles.stack} pointerEvents="none">
            {avatars.map((person, index) => (
              <Image
                cachePolicy="memory-disk"
                contentFit="cover"
                key={person.id}
                source={
                  person.avatarUrl
                    ? {
                        uri:
                          resolveProfileImageUrl(person.avatarUrl, apiBase) ??
                          undefined,
                      }
                    : avatarPlaceholder
                }
                style={[
                  styles.avatar,
                  {
                    marginLeft: index ? -10 : 0,
                    zIndex: avatars.length - index,
                  },
                ]}
              />
            ))}
          </View>
        ) : null}
        {active === "following" ? <View style={styles.underline} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderColor: "rgba(0,0,0,0.7)",
    borderRadius: 12,
    borderWidth: 1.5,
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
  idle: { color: "#bbbbbb" },
  row: { alignItems: "center", flexDirection: "row", gap: 3 },
  stack: { flexDirection: "row", marginLeft: 2 },
  text: {
    color: "#ffffff",
    fontFamily: "Outfit-SemiBold",
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
