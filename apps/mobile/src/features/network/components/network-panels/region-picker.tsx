// Native port of web's `network-panels/region-picker.tsx`. Web opens a popover
// the width of the trigger row; native drops the same panel open directly
// under the row: a search bar, then a scrolling list with a check on the
// selected region. Choosing a region saves and closes it.
import { Check, ChevronDown, Search } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { panel3d, themeText } from "@/components/surface/recipes";
import { BRAND_COLORS, useAppTheme } from "@/theme";

import type { PanelIcon } from "./panel-ui";
import { PressableRow, SettingRow } from "./panel-ui";

export function RegionPicker({
  description,
  disabled,
  icon,
  label,
  onChange,
  options,
  value,
  valueLabel,
}: {
  description: string;
  disabled: boolean;
  icon: PanelIcon;
  label: string;
  onChange: (region: string) => void;
  options: { code: string; label: string }[];
  value: string;
  valueLabel: string;
}) {
  const { isDark, theme } = useAppTheme();
  const text = themeText(isDark);
  const panel = panel3d(isDark);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filtered = options.filter(
    (option) =>
      !query ||
      option.label.toLowerCase().includes(query) ||
      option.code.toLowerCase().includes(query)
  );

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  return (
    <View>
      <SettingRow
        accessibilityLabel={`${label}. ${description}`}
        disabled={disabled}
        icon={icon}
        label={label}
        onPress={() => (open ? close() : setOpen(true))}
        trailing={
          <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
            <ChevronDown color={text.muted} size={16} />
          </View>
        }
        value={valueLabel}
      />
      {open ? (
        <View
          style={[
            styles.panel,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
            },
          ]}
        >
          <View
            style={[styles.searchBar, { borderBottomColor: theme.dividerLine }]}
          >
            <Search color={text.muted} size={16} />
            <TextInput
              accessibilityLabel="Search regions"
              autoCorrect={false}
              autoFocus
              onChangeText={setSearch}
              placeholder="Search regions"
              placeholderTextColor={text.muted}
              style={[styles.searchInput, { color: text.foreground }]}
              value={search}
            />
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={styles.list}
          >
            {filtered.length === 0 ? (
              <Text style={[styles.empty, { color: text.muted }]}>
                No regions found
              </Text>
            ) : (
              filtered.map((option) => {
                const selected = option.code === value;
                return (
                  <PressableRow
                    accessibilityLabel={option.label}
                    key={option.code}
                    onPress={() => {
                      onChange(option.code);
                      close();
                    }}
                    style={styles.option}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.optionText,
                        {
                          color: selected ? text.foreground : text.muted,
                          fontFamily: selected ? "SofiaProMed" : "SofiaProReg",
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                    {selected ? (
                      <Check color={BRAND_COLORS.primary} size={16} />
                    ) : null}
                  </PressableRow>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    paddingVertical: 24,
    textAlign: "center",
  },
  list: { maxHeight: 256, padding: 6 },
  option: {
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionText: { flex: 1, fontSize: 14 },
  panel: {
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
    overflow: "hidden",
  },
  searchBar: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    paddingVertical: 2,
  },
});
