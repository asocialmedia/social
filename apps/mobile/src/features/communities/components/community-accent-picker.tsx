// Native port of web's CommunityAccentPicker
// (apps/web/src/components/communities/create/community-accent-picker.tsx).
// Same chip language as the topic picker: a swatch dot plus label, selected
// chip tinted. Colors resolve through lib/community-accents.ts so the same
// key reads correctly in light and dark.
import { COMMUNITY_ACCENTS } from "@asm/db/communities";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

import { resolveCommunityAccentColor } from "../lib/community-accents";

// Selected-chip shadows, matching the wizard step they were extracted from.
const DARK_CHIP_SHADOW =
  "0 1px 2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)";
const LIGHT_CHIP_SHADOW =
  "0 1px 2px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)";

export function CommunityAccentPicker({
  onChange,
  value,
}: {
  onChange: (key: string) => void;
  value: string;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View style={styles.chips}>
      {COMMUNITY_ACCENTS.map((accent) => {
        const chosen = accent.key === value;
        let shadow: string | undefined;
        if (chosen) {
          shadow = isDark ? DARK_CHIP_SHADOW : LIGHT_CHIP_SHADOW;
        }
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: chosen }}
            accessibilityLabel={`${accent.label} accent`}
            key={accent.key}
            onPress={() => onChange(accent.key)}
            style={[
              styles.chip,
              {
                backgroundColor: chosen ? "#f973161a" : "transparent",
                borderColor: chosen ? "#f9731640" : "transparent",
                boxShadow: shadow,
              },
            ]}
          >
            <View
              style={[
                styles.swatch,
                {
                  backgroundColor: resolveCommunityAccentColor(
                    accent.key,
                    isDark
                  ),
                },
              ]}
            />
            <Text
              style={[
                styles.chipText,
                { color: chosen ? "#f97316" : theme.dividerText },
              ]}
            >
              {accent.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { fontFamily: "SofiaProReg", fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  swatch: { borderRadius: 5, height: 14, width: 14 },
});
