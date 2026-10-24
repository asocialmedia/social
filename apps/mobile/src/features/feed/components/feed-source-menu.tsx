import { feedSourceLabels } from "@asm/protocols/discovery";
import { useRouter } from "expo-router";
import { Check, SlidersHorizontal } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { ViewInstance } from "react-native";

import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { useAppTheme } from "@/theme";

import {
  hydrateFeedSource,
  useFeedSourceStore,
} from "../state/feed-source-store";
import { MoreMenu } from "./more-menu";
import type { MenuAnchor } from "./more-menu";

export function FeedSourceMenu({ following }: { following: boolean }) {
  const network = useNetworkSettings();
  const router = useRouter();
  useEffect(() => {
    void hydrateFeedSource();
  }, []);
  const active = network.settings.preferences.profiles.find(
    (profile) => profile.id === network.settings.preferences.activeProfileId
  );
  const entries = [
    ...(["all", "asm", "bluesky"] as const).map((value) => ({
      action: { type: value as string },
      icon: SlidersHorizontal,
      label: feedSourceLabels[value],
    })),
    ...network.settings.preferences.profiles.map((profile) => ({
      action: { type: `profile:${profile.id}` },
      icon: profile.id === active?.id ? Check : SlidersHorizontal,
      label: profile.name,
    })),
    {
      action: { type: "manage" },
      icon: SlidersHorizontal,
      label: `${active?.interests.length ?? 0} interests · ${network.settings.persona.signalCount} learned actions`,
    },
    {
      action: { type: "manage" },
      icon: SlidersHorizontal,
      label: "Manage Network preferences",
    },
    {
      action: { type: "safety" },
      icon: SlidersHorizontal,
      label: network.settings.preferences.showExplicitContent
        ? "18+ enabled · content filters"
        : "18+ hidden · content filters",
    },
    {
      action: { type: "reset" },
      icon: SlidersHorizontal,
      label: "Reset this profile's learned activity",
    },
    ...(following
      ? [
          {
            action: { type: "following" },
            icon: SlidersHorizontal,
            label: "About Following across networks",
          },
        ]
      : []),
  ];
  const { theme } = useAppTheme();
  const source = useFeedSourceStore((state) => state.source);
  const setSource = useFeedSourceStore((state) => state.setSource);
  const trigger = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return (
    <View>
      <Pressable
        accessibilityLabel={`Feed sources: ${feedSourceLabels[source]}`}
        accessibilityRole="button"
        onPress={() => {
          const bounds = trigger.current?.getBoundingClientRect();
          if (bounds) {
            setAnchor({
              height: bounds.height,
              width: bounds.width,
              x: bounds.x,
              y: bounds.y,
            });
          }
        }}
        ref={trigger}
        style={{
          alignItems: "center",
          height: 44,
          justifyContent: "center",
          width: 40,
        }}
      >
        <SlidersHorizontal color={theme.dividerText} size={18} />
      </Pressable>
      <MoreMenu<{ type: string }>
        align="end"
        anchor={anchor}
        entries={entries}
        minWidth={180}
        onAction={({ type }) => {
          if (type === "all" || type === "asm" || type === "bluesky") {
            setSource(type);
          } else if (type.startsWith("profile:")) {
            void network.save({
              ...network.settings.preferences,
              activeProfileId: type.slice(8),
            });
          } else if (type === "manage") {
            router.push("/settings?tab=network");
          } else if (type === "safety") {
            router.push(
              network.viewer === "guest"
                ? "/login"
                : "/settings?tab=network&section=moderation"
            );
          } else if (type === "reset") {
            Alert.alert(
              "Reset learned activity?",
              "Chosen interests and linked accounts are kept.",
              [
                { style: "cancel", text: "Cancel" },
                {
                  onPress: () => {
                    void network.clearActivity();
                  },
                  style: "destructive",
                  text: "Reset",
                },
              ]
            );
          } else if (type === "following") {
            Alert.alert(
              "Following",
              "Posts from your ASM and ASM-owned Bluesky follows. A linked Bluesky account isn't required."
            );
          }
        }}
        onClose={() => setAnchor(null)}
      />
    </View>
  );
}
