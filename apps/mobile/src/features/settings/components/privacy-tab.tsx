import { Shield } from "lucide-react-native";
// Native port of web's `settings/tabs/privacy-settings.tsx`.
//
// One setting, because that is all Privacy has yet: who may put this account in
// a group without being asked. The three options and the note about invite links
// are the same words as on the web, because the note is the part a reader of a
// privacy screen most needs and the part a strict option would otherwise appear
// to take away.
//
// The native app has no den picker, so nothing here is about eligibility
// rendering: the setting is a read and a write against the same server route the
// web tab uses, and the greying-out of rows lives on the web only.
import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ScrollView as ScrollViewType } from "react-native";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { getApiBaseUrl } from "@/lib/api-env";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import { fetchGroupAddSetting, setGroupAddPolicy } from "../lib/settings-api";
import type { GroupAddPolicy } from "../lib/settings-api";
import {
  SettingsCard,
  SettingsCardHeading,
  SettingsSectionHeader,
} from "./settings-ui";

interface GroupAddOption {
  description: string;
  label: string;
  value: GroupAddPolicy;
}

const GROUP_ADD_OPTIONS: GroupAddOption[] = [
  {
    description:
      "Anybody can add you to a group, whether or not you follow each other.",
    label: "Anyone",
    value: "EVERYONE",
  },
  {
    description: "Only people you already follow can add you to a group.",
    label: "Only people I follow",
    value: "FOLLOWING_ONLY",
  },
  {
    description:
      "Nobody can add you to a group directly. Invite links still work.",
    label: "No direct adds",
    value: "NO_DIRECT_ADDS",
  },
];

export function PrivacyTab({
  onChanged,
  scrollRef,
}: {
  onChanged: () => void;
  scrollRef?: RefObject<ScrollViewType | null>;
}) {
  const { isDark, theme } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const [selected, setSelected] = useState<GroupAddPolicy>("FOLLOWING_ONLY");
  const [saving, setSaving] = useState<GroupAddPolicy | null>(null);

  // The session user is the source of truth, as it is for the account tab: a
  // privacy change has to survive a sign-out and sign-in without a second fetch.
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      const setting = await fetchGroupAddSetting(options);
      if (!cancelled && setting) {
        setSelected(setting.groupAddPolicy);
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback(
    async (policy: GroupAddPolicy) => {
      const previous = selected;
      setSelected(policy);
      setSaving(policy);
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      const result = await runWithInstallToken(
        () => setGroupAddPolicy(policy, options),
        (value) => Boolean(value && value.kind === "install-token-required")
      );
      setSaving(null);
      if (result === null) {
        return;
      }
      if (result.kind === "error") {
        // Rolled back, because a row that snapped to the new choice and stayed
        // there would be a setting the server never accepted.
        setSelected(previous);
        toast({
          description: result.message,
          title: "Couldn't save",
          variant: "destructive",
        });
        return;
      }
      onChanged();
    },
    [onChanged, runWithInstallToken, selected]
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      ref={scrollRef}
      showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
    >
      <SettingsSectionHeader
        description="Who can reach you, and who can put you in a group"
        icon={Shield}
        title="Privacy"
      />
      <SettingsCard>
        <SettingsCardHeading
          description="Applies to new groups. It never changes a group you are already in."
          icon={Shield}
          title="Who can add me to a group"
        />
        <View accessibilityRole="radiogroup" style={styles.options}>
          {GROUP_ADD_OPTIONS.map((option) => {
            const checked = selected === option.value;
            const busy = saving === option.value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked, disabled: busy }}
                key={option.value}
                onPress={() => {
                  if (!checked && !busy) {
                    void choose(option.value);
                  }
                }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: theme.cardBg,
                    borderColor: checked ? "#ff9500" : theme.cardBorder,
                    boxShadow: isDark
                      ? "inset 0 0 0 1px rgba(255,255,255,0.05)"
                      : "inset 0 0 0 1px rgba(255,255,255,0.6)",
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.marker,
                    {
                      backgroundColor: checked ? "#ff9500" : "transparent",
                      borderColor: checked ? "#ff9500" : theme.dividerText,
                    },
                  ]}
                />
                <View style={styles.optionText}>
                  <Text
                    style={[styles.optionLabel, { color: theme.inputText }]}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={[
                      styles.optionDescription,
                      { color: theme.dividerText },
                    ]}
                  >
                    {option.description}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.note, { color: theme.dividerText }]}>
          Invite links are not affected by this. Anyone you send one to can
          still open it and join, because joining is your decision rather than
          theirs.
        </Text>
      </SettingsCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  marker: {
    borderCurve: "continuous",
    borderRadius: 999,
    borderWidth: 2,
    height: 18,
    marginTop: 2,
    width: 18,
  },
  note: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  option: {
    alignItems: "flex-start",
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  optionDescription: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    lineHeight: 18,
  },
  optionLabel: { fontFamily: "SofiaProMed", fontSize: 14 },
  optionText: { flex: 1, gap: 2 },
  options: { gap: 8, marginTop: 14 },
});
