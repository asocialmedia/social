// Native port of web's CommunityTopicPicker
// (apps/web/src/components/communities/create/community-topic-picker.tsx).
// Same multi-select chip taxonomy, same cap copy (`{n}/5 selected`), same
// at-cap disabling. The max-topics rule itself lives in
// lib/community-create-contract.ts (`canAddTopic`) and is tested there.
import { COMMUNITY_TOPICS } from "@asm/db/communities";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

import {
  canAddTopic,
  COMMUNITY_LIMITS,
} from "../lib/community-create-contract";
import type { CommunityTopic } from "../lib/community-create-contract";

export function CommunityTopicPicker({
  onChange,
  selected,
}: {
  onChange: (topics: string[]) => void;
  selected: string[];
}) {
  const { isDark, theme } = useAppTheme();
  const toggle = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter((topic) => topic !== key));
      return;
    }
    if (
      selected.length < COMMUNITY_LIMITS.topicsMax &&
      canAddTopic(selected as CommunityTopic[], key as CommunityTopic)
    ) {
      onChange([...selected, key]);
    }
  };
  const atCap = selected.length >= COMMUNITY_LIMITS.topicsMax;
  return (
    <View style={styles.root}>
      <View style={styles.chips}>
        {COMMUNITY_TOPICS.map((topic) => {
          const chosen = selected.includes(topic.key);
          const disabled = !chosen && atCap;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: chosen, disabled }}
              disabled={disabled}
              key={topic.key}
              onPress={() => toggle(topic.key)}
              style={[
                styles.chip,
                chosen && {
                  backgroundColor: "#f973161a",
                  borderColor: "#f9731640",
                  boxShadow: isDark
                    ? "0 1px 2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)"
                    : "0 1px 2px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
                },
                !chosen && { borderColor: "transparent" },
                disabled && styles.disabled,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: chosen ? "#f97316" : theme.dividerText },
                ]}
              >
                {topic.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.count, { color: theme.dividerText }]}>
        {selected.length}/{COMMUNITY_LIMITS.topicsMax} selected
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontFamily: "SofiaProReg", fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  count: { fontFamily: "SofiaProReg", fontSize: 12 },
  disabled: { opacity: 0.4 },
  root: { gap: 10 },
});
