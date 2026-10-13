import { Palette } from "lucide-react-native";
import type { RefObject } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useThemePreference } from "@/theme/theme-preference-native";

import { SectionAnchor } from "../lib/settings-scroll";
import { SettingsChoice } from "./settings-choice";
import {
  SettingsCard,
  SettingsCardHeading,
  SettingsSectionHeader,
} from "./settings-ui";

const OPTIONS = [
  {
    description: "Bright surfaces with soft shadows.",
    label: "Light",
    value: "light",
  },
  {
    description: "Dim surfaces for a darker appearance.",
    label: "Dark",
    value: "dark",
  },
  {
    description: "Follow your device's light or dark appearance.",
    label: "System",
    value: "system",
  },
] as const;

export function PersonalizationTab({
  scrollRef,
}: {
  scrollRef: RefObject<ScrollView | null>;
}) {
  const insets = useSafeAreaInsets();
  const preference = useThemePreference((state) => state.preference);
  const setPreference = useThemePreference((state) => state.setPreference);
  return (
    <ScrollView
      ref={scrollRef}
      showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
      contentContainerStyle={{
        gap: 16,
        padding: 16,
        paddingBottom: 96 + insets.bottom,
      }}
    >
      <SettingsSectionHeader
        icon={Palette}
        title="Personalization"
        description="Make asocialmedia feel like yours"
      />
      <SectionAnchor id="settings-appearance" tab="personalization">
        <SettingsCard>
          <SettingsCardHeading
            icon={Palette}
            title="Appearance"
            description="Saved on this device. Changes apply across the app."
          />
          <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
            {OPTIONS.map((option) => (
              <SettingsChoice
                key={option.value}
                checked={preference === option.value}
                label={option.label}
                description={option.description}
                onPress={() => setPreference(option.value)}
              />
            ))}
          </View>
        </SettingsCard>
      </SectionAnchor>
    </ScrollView>
  );
}
