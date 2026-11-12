// Native port of web's `network-panels/languages-panel.tsx`: one card with the
// "Geography and language" heading, the Content languages row and its chosen
// pills, the Regional content picker, and the regional-relevance note.
import { NETWORK_LANGUAGES } from "@asm/protocols/discovery";
import type { NetworkPreferences } from "@asm/protocols/discovery";
import { ChevronRight, Globe, Languages } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { themeText } from "@/components/surface/recipes";
import { SettingsCard } from "@/features/settings/components/settings-ui";
import { SectionAnchor } from "@/features/settings/lib/settings-scroll";
import { useAppTheme } from "@/theme";

import {
  networkDisplayNames,
  networkLocaleChoices,
} from "../../lib/display-names";
import { contentRegionLabel } from "../../lib/locale-selection";
import { ContentLanguagesDialog } from "./content-languages-dialog";
import type { NetworkPanelProps } from "./panel-props";
import { OrangeMark, SettingRow, SettingsPill } from "./panel-ui";
import { RegionPicker } from "./region-picker";

// Web casts the first chosen code into the `language` enum; the shared schema
// rejects codes outside NETWORK_LANGUAGES, so native picks the first chosen
// code the enum accepts and falls back to English.
function primaryLanguage(
  languages: readonly string[]
): NetworkPreferences["language"] {
  if (languages.length === 0) {
    return "all";
  }
  for (const code of languages) {
    const match = NETWORK_LANGUAGES.find((language) => language === code);
    if (match) {
      return match;
    }
  }
  return "en";
}

export function LanguagesPanel({
  isSaving,
  preferences,
  save,
}: NetworkPanelProps) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const [dialogOpen, setDialogOpen] = useState(false);
  const names = useMemo(() => networkDisplayNames(), []);
  const languages = useMemo(
    () => networkLocaleChoices(names.language, "language"),
    [names]
  );
  const regions = useMemo(
    () => networkLocaleChoices(names.region, "region"),
    [names]
  );
  const selectedLanguages = preferences.contentLanguages;
  const languageName = (code: string) => names.language.of(code) ?? code;

  let languageSummary = "All languages (none selected)";
  if (selectedLanguages.length > 0) {
    const labels = selectedLanguages.map(languageName);
    languageSummary =
      labels.length <= 3
        ? labels.join(", ")
        : `${labels.slice(0, 2).join(", ")} + ${labels.length - 2} more`;
  }

  const updateLanguages = (next: string[]) => {
    void save({
      ...preferences,
      contentLanguages: next,
      language: primaryLanguage(next),
    });
  };

  return (
    <>
      <SectionAnchor id="settings-network-region" tab="network">
        <SettingsCard style={styles.card}>
          <View style={styles.heading}>
            <OrangeMark icon={Globe} />
            <View style={styles.headingCopy}>
              <Text style={[styles.headingTitle, { color: text.foreground }]}>
                Geography and language
              </Text>
              <Text style={[styles.headingDescription, { color: text.muted }]}>
                Prefer content in your languages and about your region.
              </Text>
            </View>
          </View>

          <View style={styles.rows}>
            <SettingRow
              accessibilityLabel="Select content languages"
              disabled={isSaving}
              icon={Languages}
              label="Content languages"
              onPress={() => setDialogOpen(true)}
              trailing={
                <View style={styles.trailing}>
                  <Text style={[styles.trailingText, { color: text.muted }]}>
                    {selectedLanguages.length === 0
                      ? "All"
                      : `${selectedLanguages.length} selected`}
                  </Text>
                  <ChevronRight color={text.muted} size={16} />
                </View>
              }
              value={languageSummary}
            />

            {selectedLanguages.length > 0 ? (
              <View style={styles.pills}>
                {selectedLanguages.map((code) => (
                  <SettingsPill
                    disabled={isSaving}
                    key={code}
                    label={languageName(code)}
                    onRemove={() =>
                      updateLanguages(
                        selectedLanguages.filter((entry) => entry !== code)
                      )
                    }
                  />
                ))}
              </View>
            ) : (
              <Text style={[styles.pillsEmpty, { color: text.muted }]}>
                All languages are currently shown in your feeds.
              </Text>
            )}

            <RegionPicker
              description="Local stories rank first when they exist."
              disabled={isSaving}
              icon={Globe}
              label="Regional content"
              onChange={(region) => {
                void save({ ...preferences, region });
              }}
              options={regions}
              value={preferences.region}
              valueLabel={contentRegionLabel(preferences.region, (code) =>
                names.region.of(code)
              )}
            />
          </View>

          <Text style={[styles.note, { color: text.muted }]}>
            Regional relevance is a preference, not a claim about where a person
            lives or publishes from. Feeds stay global when local candidates are
            unavailable.
          </Text>
        </SettingsCard>
      </SectionAnchor>

      {dialogOpen ? (
        <ContentLanguagesDialog
          languages={languages}
          onClose={() => setDialogOpen(false)}
          onSelectLanguages={updateLanguages}
          selectedLanguages={selectedLanguages}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 16 },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
    paddingLeft: 12,
  },
  headingCopy: { flex: 1, minWidth: 0 },
  headingDescription: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
  },
  headingTitle: { fontFamily: "SofiaProMed", fontSize: 16 },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  // `px-3 pb-1 pl-15`: 12px row padding + 36px tile + 12px gap.
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 4,
    paddingLeft: 60,
    paddingRight: 12,
  },
  pillsEmpty: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    paddingBottom: 4,
    paddingLeft: 60,
    paddingRight: 12,
  },
  rows: { gap: 4 },
  trailing: { alignItems: "center", flexDirection: "row", gap: 4 },
  trailingText: { fontFamily: "SofiaProMed", fontSize: 12 },
});
