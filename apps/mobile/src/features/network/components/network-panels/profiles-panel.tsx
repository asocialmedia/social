// Native port of web's `network-panels/profiles-panel.tsx`.
import { randomUUID } from "expo-crypto";
import { Brain, Check, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { themeText } from "@/components/surface/recipes";
import {
  SettingsButton,
  SettingsCard,
  SettingsCardHeading,
  SettingsInput,
} from "@/features/settings/components/settings-ui";
import { SectionAnchor } from "@/features/settings/lib/settings-scroll";
import { haptic } from "@/lib/interaction/haptics";
import { useAppTheme } from "@/theme";

import type { NetworkPanelProps } from "./panel-props";

// shadcn's `outline` small button: a hairline edge on the page surface.
function OutlineChoice({
  disabled,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  const pressedBackground = isDark
    ? "rgba(255,255,255,0.08)"
    : "rgba(0,0,0,0.04)";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: false }}
      disabled={disabled}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.outline,
        {
          backgroundColor: pressed ? pressedBackground : theme.containerBg,
          borderColor: theme.cardBorder,
        },
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        style={[styles.outlineText, { color: themeText(isDark).foreground }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ProfilesPanel({
  isSaving,
  preferences,
  profile,
  save,
}: NetworkPanelProps) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const [profileName, setProfileName] = useState("");
  const canCreate =
    !isSaving && Boolean(profileName.trim()) && preferences.profiles.length < 8;

  const create = () => {
    if (!profileName.trim() || preferences.profiles.length >= 8) {
      return;
    }
    const created = {
      id: randomUUID(),
      interests: [],
      name: profileName.trim(),
    };
    void save({
      ...preferences,
      activeProfileId: created.id,
      profiles: [...preferences.profiles, created],
    });
    setProfileName("");
  };

  return (
    <SectionAnchor id="settings-network-profiles" tab="network">
      <SettingsCard style={styles.card}>
        <SettingsCardHeading
          description="Different sides of you, with their own interests and recent activity."
          icon={Brain}
          title="Recommendation profiles"
        />
        <View accessibilityLabel="Recommendation profiles" style={styles.wrap}>
          {preferences.profiles.map((entry) =>
            entry.id === profile.id ? (
              <SettingsButton
                disabled={isSaving}
                key={entry.id}
                label={entry.name}
                leadingIcon={Check}
                onPress={() => {
                  void save({ ...preferences, activeProfileId: entry.id });
                }}
                size="sm"
              />
            ) : (
              <OutlineChoice
                disabled={isSaving}
                key={entry.id}
                label={entry.name}
                onPress={() => {
                  void save({ ...preferences, activeProfileId: entry.id });
                }}
              />
            )
          )}
        </View>
        <View style={styles.createRow}>
          <View style={styles.createInput}>
            <SettingsInput
              autoCapitalize="words"
              hideLabel
              label="New recommendation profile name"
              maxLength={40}
              onChangeText={setProfileName}
              placeholder="Name a profile, e.g. Studio or After hours"
              value={profileName}
            />
          </View>
          <SettingsButton
            disabled={!canCreate}
            label="Create"
            leadingIcon={Plus}
            onPress={create}
          />
        </View>
        {preferences.profiles.length > 1 ? (
          <View style={styles.deleteRow}>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => {
                haptic();
                const profiles = preferences.profiles.filter(
                  (entry) => entry.id !== profile.id
                );
                void save({
                  ...preferences,
                  activeProfileId: profiles[0]?.id ?? "default",
                  profiles,
                });
              }}
              style={({ pressed }) => [
                styles.ghost,
                pressed
                  ? {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(0,0,0,0.05)",
                    }
                  : null,
                isSaving ? styles.disabled : null,
              ]}
            >
              <Trash2 color={text.foreground} size={14} />
              <Text style={[styles.outlineText, { color: text.foreground }]}>
                Delete {profile.name}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <Text style={[styles.note, { color: text.muted }]}>
          Chosen interests stay. Recent activity fades over 30 days. Switch
          profiles from Home’s feed settings.
        </Text>
      </SettingsCard>
    </SectionAnchor>
  );
}

const styles = StyleSheet.create({
  card: { gap: 16 },
  createInput: { flex: 1, minWidth: 0 },
  createRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  deleteRow: { alignItems: "flex-start" },
  disabled: { opacity: 0.5 },
  ghost: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
  },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  outline: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 9999,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  outlineText: { fontFamily: "SofiaProMed", fontSize: 14 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
