import { useState } from "react";
import { Modal, Pressable, ScrollView, Text } from "react-native";

import { panel3d } from "@/components/surface/recipes";
import { SettingsChoice } from "@/features/settings/components/settings-choice";
import {
  SettingsButton,
  SettingsInput,
} from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

export function NetworkLocalePicker({
  title,
  options,
  selected,
  onSelect,
  onClose,
  disabled,
  multiple = false,
}: {
  title: string;
  options: readonly { code: string; label: string }[];
  selected: readonly string[];
  onSelect: (code: string) => void;
  onClose: () => void;
  disabled: boolean;
  multiple?: boolean;
}) {
  const [query, setQuery] = useState("");
  const { isDark, theme } = useAppTheme();
  const panel = panel3d(isDark);
  const matches = options.filter((option) =>
    `${option.label} ${option.code}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          backgroundColor: "rgba(0,0,0,0.6)",
          flex: 1,
          justifyContent: "center",
          padding: 20,
        }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          accessibilityViewIsModal
          style={{
            backgroundColor: panel.background,
            borderColor: panel.border,
            borderRadius: 16,
            borderWidth: 1,
            boxShadow: panel.shadows,
            gap: 12,
            maxHeight: "85%",
            padding: 16,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{
              color: theme.inputText,
              fontFamily: "SofiaProBold",
              fontSize: 18,
            }}
          >
            {title}
          </Text>
          <SettingsInput
            label="Search"
            placeholder="Search by name or code"
            value={query}
            onChangeText={setQuery}
          />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8 }}
          >
            {matches.map((option) => (
              <SettingsChoice
                key={option.code}
                checked={selected.includes(option.code)}
                selectionRole={multiple ? "checkbox" : "radio"}
                disabled={disabled}
                label={option.label}
                description={option.code}
                onPress={() => onSelect(option.code)}
              />
            ))}
            {matches.length ? null : (
              <Text style={{ color: theme.dividerText }}>No matches</Text>
            )}
          </ScrollView>
          <SettingsButton label="Done" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
