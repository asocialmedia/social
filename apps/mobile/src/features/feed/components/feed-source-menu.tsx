import type { FeedSource } from "@asm/protocols/discovery";
import { feedSourceLabels } from "@asm/protocols/discovery";
import { Check, SlidersHorizontal } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { useAppTheme } from "@/theme";

import { useFeedSourceStore } from "../state/feed-source-store";
import { MoreMenu } from "./more-menu";
import type { MenuAnchor } from "./more-menu";

export function FeedSourceMenu({ following }: { following: boolean }) {
  const { theme } = useAppTheme();
  const source = useFeedSourceStore((state) => state.source);
  const setSource = useFeedSourceStore((state) => state.setSource);
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return (
    <View>
      <Pressable
        accessibilityLabel={`Feed sources: ${following ? "ASM" : feedSourceLabels[source]}`}
        accessibilityRole="button"
        onPress={() =>
          trigger.current?.measureInWindow((x, y, width, height) =>
            setAnchor({ height, width, x, y })
          )
        }
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
      <MoreMenu<{ type: FeedSource }>
        align="end"
        anchor={anchor}
        entries={(following
          ? (["asm"] as const)
          : (["all", "asm", "bluesky"] as const)
        ).map((value) => ({
          action: { type: value },
          icon:
            (following ? "asm" : source) === value ? Check : SlidersHorizontal,
          label: feedSourceLabels[value],
        }))}
        minWidth={180}
        onAction={({ type }) => {
          if (!following) {
            setSource(type);
          }
        }}
        onClose={() => setAnchor(null)}
      />
    </View>
  );
}
