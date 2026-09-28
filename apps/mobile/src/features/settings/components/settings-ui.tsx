// The settings chrome, ported from web's `components/settings/settings-section-card.tsx`
// and the status chip it exposes. Every account and security control sits in one
// of these, so the cards, headings and chips cannot drift between sections.
import type { ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { premiumInput, themeText } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

import type { SettingsTab } from "../lib/settings-tabs";
import { SETTINGS_TAB_META } from "../lib/settings-tabs";

/** Web's `SettingsSectionHeader`: title, muted description, optional anchor. */
export function SettingsSectionHeader({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.header}>
      <Text style={[styles.headerTitle, { color: theme.inputText }]}>
        {title}
      </Text>
      <Text style={[styles.headerDescription, { color: theme.dividerText }]}>
        {description}
      </Text>
    </View>
  );
}

/** Web's `SettingsCard`: the raised surface every control group lives in. */
export function SettingsCard({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark
            ? "inset 0 0 0 1px rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.3)"
            : "inset 0 0 0 1px rgba(255,255,255,0.6), 0 1px 2px rgba(0,0,0,0.05)",
        },
      ]}
    >
      {title ? (
        <Text style={[styles.cardTitle, { color: theme.inputText }]}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export type SettingsChipTone = "danger" | "neutral" | "primary";

// Resolved in one place so the chip, the settings button and the accent underline
// all quote the same orange and the same destructive tone.
function chipColor(
  tone: SettingsChipTone,
  isDark: boolean,
  muted: string
): string {
  if (tone === "primary") {
    return "#ff9500";
  }
  if (tone === "danger") {
    return themeText(isDark).destructive;
  }
  return muted;
}

/**
 * Web's `SettingsStatusChip`. The tone is carried by the text and a hairline
 * rather than a filled pill, so a row of chips does not read as a row of
 * buttons.
 */
export function SettingsStatusChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: SettingsChipTone;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: chipColor(tone, isDark, theme.dividerText) },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/** Web's `SettingsCardHeading`: a row of title plus a trailing control. */
export function SettingsCardHeading({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingCopy}>{children}</View>
      {action}
    </View>
  );
}

/** The tab strip, standing in for web's desktop settings sidebar. */
export function SettingsTabBar({
  active,
  onChange,
}: {
  active: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.tabBar}>
      {(["profile", "account", "security"] as const).map((tab) => {
        const selected = tab === active;
        return (
          <View key={tab} style={styles.tabSlot}>
            <Text
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => {
                onChange(tab);
              }}
              style={[
                styles.tabLabel,
                { color: selected ? "#ff9500" : theme.dividerText },
              ]}
            >
              {SETTINGS_TAB_META[tab].label}
            </Text>
            {selected ? (
              <Gradient3D
                colors={["#ff9500", "#e65500"]}
                radius={2}
                shadows=""
                style={styles.tabUnderline}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function SettingsButton({
  disabled,
  label,
  onPress,
  tone = "primary",
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: SettingsChipTone;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <Text
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { color: chipColor(tone, isDark, theme.dividerText) },
        disabled && styles.buttonDisabled,
      ]}
    >
      {label}
    </Text>
  );
}

/** Web's premium-input, the base every settings field uses. */
export function SettingsInput({
  autoCapitalize = "none",
  editable = true,
  keyboardType,
  label,
  maxLength,
  onChangeText,
  placeholder,
  secureTextEntry,
  value,
}: {
  autoCapitalize?: "none" | "sentences" | "words";
  editable?: boolean;
  keyboardType?: "default" | "email-address" | "numeric";
  label: string;
  maxLength?: number;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  value: string;
}) {
  const { isDark, theme } = useAppTheme();
  const field = premiumInput(isDark, false);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.dividerText }]}>
        {label}
      </Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        keyboardType={keyboardType}
        maxLength={maxLength}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={field.placeholder}
        secureTextEntry={secureTextEntry}
        style={[
          styles.input,
          {
            backgroundColor: field.background,
            boxShadow: field.shadows,
            color: field.text,
          },
        ]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { fontFamily: "SofiaProMed", fontSize: 14 },
  buttonDisabled: { opacity: 0.45 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  cardTitle: { fontFamily: "SofiaProMed", fontSize: 15 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipText: { fontFamily: "SofiaProMed", fontSize: 11 },
  field: { gap: 6 },
  fieldLabel: { fontFamily: "SofiaProMed", fontSize: 13 },
  header: { gap: 4 },
  headerDescription: { fontFamily: "SofiaProReg", fontSize: 13 },
  headerTitle: { fontFamily: "SofiaProBold", fontSize: 22 },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  headingCopy: { flex: 1, minWidth: 0 },
  input: {
    borderCurve: "continuous",
    borderRadius: 12,
    fontFamily: "SofiaProReg",
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  tabBar: { flexDirection: "row", gap: 18, paddingHorizontal: 16 },
  tabLabel: { fontFamily: "SofiaProMed", fontSize: 14, paddingVertical: 8 },
  tabSlot: { alignItems: "flex-start" },
  tabUnderline: { height: 2, marginTop: 2, width: "100%" },
});
