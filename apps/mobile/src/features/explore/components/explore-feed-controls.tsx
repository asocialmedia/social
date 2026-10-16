import { discoveryFeedPress } from "@asm/ui/lib/home-feed-controls";
import { ChevronDown, Flame, Sparkles } from "lucide-react-native";
import type { LucideProps } from "lucide-react-native";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { FeedTabs } from "@/features/feed/components/feed-tabs";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type { MenuAnchor } from "@/features/feed/components/more-menu";
import type {
  ExploreDiscoveryTab,
  ExploreTab,
} from "@/features/feed/state/tab-store";
import { useAppTheme } from "@/theme";

import { exploreFeedTabs } from "../lib/explore-navigation";

function FilledSparkles(props: LucideProps) {
  return <Sparkles {...props} fill={props.color ?? "currentColor"} />;
}
function FilledFlame(props: LucideProps) {
  return <Flame {...props} fill={props.color ?? "currentColor"} />;
}

export function ExploreFeedControls({
  active,
  discovery,
  onChange,
}: {
  active: ExploreTab;
  discovery: ExploreDiscoveryTab;
  onChange: (tab: ExploreTab) => void;
}) {
  const { theme } = useAppTheme();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [discoveryLabelX, setDiscoveryLabelX] = useState(0);
  const [discoveryTextLayouts, setDiscoveryTextLayouts] = useState<
    Partial<Record<ExploreDiscoveryTab, { x: number; width: number }>>
  >({});
  const discoveryText = discoveryTextLayouts[discovery];
  const tabs = exploreFeedTabs(discovery);
  return (
    <View>
      <FeedTabs<ExploreTab>
        active={active}
        tabs={tabs}
        onPressActive
        indicatorLabelLayout={(tab) => {
          if (tab.value !== discovery) {
            return;
          }
          if (!discoveryText) {
            return null;
          }
          return {
            width: discoveryText.width,
            x: discoveryLabelX + discoveryText.x,
          };
        }}
        indicatorWidth={(tab, width) => {
          if (tab.value === discovery) {
            return width * 0.6;
          }
          return 24;
        }}
        onChange={(value) => {
          if (value === discovery) {
            const action = discoveryFeedPress(active, discovery);
            if (action.type === "navigate") {
              onChange(action.feed);
              return;
            }
            trigger.current?.measureInWindow((x, y, width, height) =>
              setAnchor({ height, width, x, y })
            );
          } else {
            onChange(value);
          }
        }}
        renderLabel={(tab, selected) => (
          <View
            ref={tab.value === discovery ? trigger : undefined}
            onLayout={(event) => {
              if (tab.value === discovery) {
                setDiscoveryLabelX(event.nativeEvent.layout.x);
              }
            }}
            style={styles.label}
          >
            <Text
              testID={
                tab.value === discovery ? "explore-discovery-label" : undefined
              }
              onLayout={(event) => {
                if (tab.value !== discovery) {
                  return;
                }
                const { width, x } = event.nativeEvent.layout;
                setDiscoveryTextLayouts((current) =>
                  current[discovery]?.width === width &&
                  current[discovery]?.x === x
                    ? current
                    : { ...current, [discovery]: { width, x } }
                );
              }}
              style={{
                color: selected ? theme.inputText : theme.dividerText,
                fontFamily: selected ? "SofiaProBold" : "SofiaProMed",
                fontSize: 14,
              }}
            >
              {tab.label}
            </Text>
            {tab.value === discovery ? (
              <ChevronDown
                color={selected ? theme.inputText : theme.dividerText}
                size={14}
              />
            ) : null}
          </View>
        )}
      />
      <MoreMenu<{ type: "for-you" | "trending" }>
        align="start"
        anchor={anchor}
        minWidth={128}
        entries={(["for-you", "trending"] as const)
          .filter((value) => value !== discovery)
          .map((value) => ({
            action: { type: value },
            icon: value === "for-you" ? FilledSparkles : FilledFlame,
            label: value === "for-you" ? "For you" : "Trending",
          }))}
        onClose={() => setAnchor(null)}
        onAction={({ type }) => {
          onChange(type);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { alignItems: "center", flexDirection: "row", gap: 5 },
});
