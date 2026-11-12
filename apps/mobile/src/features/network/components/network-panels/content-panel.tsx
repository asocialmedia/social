// Native port of web's `network-panels/content-panel.tsx`: Interests, Recent
// activity and Topic connections.
import { interestSchema } from "@asm/protocols/discovery";
import { Network, Sparkles } from "lucide-react-native";
import { Text, View } from "react-native";

import { themeText } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

import { TopicPicker } from "../topic-picker";
import type { NetworkPanelProps } from "./panel-props";
import { PanelSection, SettingsPill, TopicTag, panelStyles } from "./panel-ui";
import { RecentActivityCard } from "./recent-activity-card";

export function ContentPanel({
  clearActivity,
  isSaving,
  persona,
  preferences,
  profile,
  revision,
  save,
}: NetworkPanelProps) {
  const { isDark } = useAppTheme();
  const { muted } = themeText(isDark);
  const { interests } = profile;

  const updateInterests = (next: string[]) => {
    void save({
      ...preferences,
      profiles: preferences.profiles.map((entry) =>
        entry.id === profile.id ? { ...entry, interests: next } : entry
      ),
    });
  };

  const toggleInterest = (topic: string) => {
    const parsed = interestSchema.safeParse(topic);
    if (!parsed.success) {
      return;
    }
    updateInterests(
      interests.includes(parsed.data)
        ? interests.filter((entry) => entry !== parsed.data)
        : [...interests, parsed.data].slice(0, 32)
    );
  };

  return (
    <>
      <PanelSection
        count={interests.length ? `${interests.length} of 32` : undefined}
        description={`Your feeds pull in related subjects discovered from these topics, for ${profile.name}.`}
        icon={Sparkles}
        id="settings-network-interests"
        title="Interests"
      >
        <View style={panelStyles.body}>
          <TopicPicker
            disabled={false}
            label="Find or add an interest"
            limit={32}
            onToggle={toggleInterest}
            selected={interests}
          />
          {interests.length ? (
            <View
              accessibilityLabel="Chosen interests"
              style={panelStyles.wrap}
            >
              {interests.map((topic) => (
                <SettingsPill
                  disabled={isSaving}
                  key={topic}
                  label={topic}
                  onRemove={() => toggleInterest(topic)}
                />
              ))}
            </View>
          ) : (
            <Text style={[panelStyles.muted, { color: muted }]}>
              Nothing chosen yet. Search above, or explore a suggestion to see
              up to ten related subjects.
            </Text>
          )}
        </View>
      </PanelSection>

      <RecentActivityCard
        clearActivity={clearActivity}
        disabled={isSaving}
        persona={persona}
        revision={revision}
      />

      <PanelSection
        description="Related subjects connected to this profile’s interests."
        icon={Network}
        id="settings-network-connections"
        title="Topic connections"
      >
        {persona.relatedInterests.length ? (
          <View style={[panelStyles.wrap, { paddingHorizontal: 12 }]}>
            {persona.relatedInterests.map((topic) => (
              <TopicTag key={topic} label={topic} />
            ))}
          </View>
        ) : (
          <Text
            style={[
              panelStyles.mutedSm,
              { color: muted, paddingHorizontal: 12 },
            ]}
          >
            Topic connections appear as you choose interests and browse.
          </Text>
        )}
      </PanelSection>
    </>
  );
}
