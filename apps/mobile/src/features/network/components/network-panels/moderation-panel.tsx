// Native port of web's `network-panels/moderation-panel.tsx`: Explicit content
// and Not interested.
import { Shield, Sparkles } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { themeText } from "@/components/surface/recipes";
import { SettingsSwitch } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import { TopicPicker } from "../topic-picker";
import type { NetworkPanelProps } from "./panel-props";
import { PanelSection, SettingsPill, panelStyles } from "./panel-ui";

export function ModerationPanel({
  isSaving,
  persona,
  preferences,
  profile,
  save,
}: NetworkPanelProps) {
  const { isDark, theme } = useAppTheme();
  const text = themeText(isDark);
  const avoided = preferences.avoidedTopics;

  return (
    <>
      <PanelSection
        description="Media warnings still appear before content is revealed."
        icon={Shield}
        id="settings-network-explicit"
        title="Explicit content"
      >
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={[styles.switchLabel, { color: text.foreground }]}>
              Show explicit content (18+)
            </Text>
            <Text
              style={[
                panelStyles.muted,
                styles.switchHint,
                { color: text.muted },
              ]}
            >
              Enable only if you’re 18 or older. Off by default, and applies to
              Home, Explore, Gusts, and every profile.
            </Text>
          </View>
          <SettingsSwitch
            accessibilityLabel="Show explicit content (18+)"
            disabled={isSaving}
            onValueChange={(checked) => {
              void save({ ...preferences, showExplicitContent: checked });
            }}
            value={preferences.showExplicitContent}
          />
        </View>
      </PanelSection>

      <PanelSection
        count={avoided.length ? `${avoided.length} of 64` : undefined}
        description="Hide matching topics and compound tags from every feed."
        icon={Sparkles}
        id="settings-network-avoid"
        title="Not interested"
      >
        <View style={panelStyles.body}>
          <TopicPicker
            disabled={isSaving}
            label="Topic to avoid"
            limit={64}
            onToggle={(topic) => {
              void save({
                ...preferences,
                avoidedTopics: avoided.includes(topic)
                  ? avoided.filter((entry) => entry !== topic)
                  : [...avoided, topic].slice(0, 64),
              });
            }}
            selected={avoided}
          />
          {avoided.length ? (
            <View accessibilityLabel="Avoided topics" style={panelStyles.wrap}>
              {avoided.map((topic) => (
                <SettingsPill
                  disabled={isSaving}
                  key={topic}
                  label={topic}
                  onRemove={() => {
                    void save({
                      ...preferences,
                      avoidedTopics: avoided.filter((value) => value !== topic),
                    });
                  }}
                />
              ))}
            </View>
          ) : (
            <Text style={[panelStyles.muted, { color: text.muted }]}>
              Nothing hidden yet. A topic such as furry also hides furryart and
              similar tagged formats.
            </Text>
          )}
          <View
            accessibilityLiveRegion="polite"
            style={[panelStyles.divider, { borderTopColor: theme.dividerLine }]}
          >
            <Text style={[panelStyles.muted, { color: text.muted }]}>
              {persona.avoidedTopics.length
                ? `Showing less in ${profile.name} from mutes and downvotes: ${persona.avoidedTopics.join(", ")}.`
                : "Mutes, downvotes, and Not interested teach this profile what to show less of."}
            </Text>
            <Text style={[panelStyles.muted, { color: text.muted }]}>
              Learned preferences fade over 30 days. Add a learned topic above
              to hide it explicitly.
            </Text>
          </View>
        </View>
      </PanelSection>
    </>
  );
}

const styles = StyleSheet.create({
  switchCopy: { flex: 1, minWidth: 0 },
  switchHint: { marginTop: 4 },
  switchLabel: { fontFamily: "SofiaProMed", fontSize: 14 },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
});
