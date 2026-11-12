// Native port of web's `network-panels/content-languages-dialog.tsx`: a search
// field, a "Recently used" group (the chosen languages plus a few popular
// ones) and "All languages", as flat rows with a check. Every tap saves at
// once, so there is no Done button; closing the dialog dismisses it.
import { Check, Search, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { DialogPanel } from "@/components/surface/dialog-panel";
import { themeText } from "@/components/surface/recipes";
import {
  BRAND_COLORS,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import { PressableRow } from "./panel-ui";

const POPULAR_CODES = ["en", "ja", "pt", "de"];

interface LanguageOption {
  code: string;
  label: string;
}

function LanguageRow({
  checked,
  label,
  onPress,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  return (
    <PressableRow
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.row}
    >
      <Text
        style={[
          styles.rowText,
          {
            color: text.foreground,
            fontFamily: checked ? "SofiaProMed" : "SofiaProReg",
          },
        ]}
      >
        {label}
      </Text>
      {checked ? (
        <Check color={BRAND_COLORS.primary} size={16} strokeWidth={2.5} />
      ) : null}
    </PressableRow>
  );
}

export function ContentLanguagesDialog({
  languages,
  onClose,
  onSelectLanguages,
  selectedLanguages,
}: {
  languages: LanguageOption[];
  onClose: () => void;
  onSelectLanguages: (languages: string[]) => void;
  selectedLanguages: string[];
}) {
  const { isDark, theme } = useAppTheme();
  const text = themeText(isDark);
  const { height } = useWindowDimensions();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matches = (option: LanguageOption) =>
    !query ||
    option.label.toLowerCase().includes(query) ||
    option.code.toLowerCase().includes(query);

  const labelOf = useMemo(() => {
    const map = new Map(languages.map((entry) => [entry.code, entry.label]));
    return (code: string) => map.get(code) ?? code;
  }, [languages]);

  const recentlyUsed = [...new Set([...selectedLanguages, ...POPULAR_CODES])]
    .map((code) => ({ code, label: labelOf(code) }))
    .filter(matches);
  const filtered = languages.filter(matches);

  const toggleLanguage = (code: string) => {
    onSelectLanguages(
      selectedLanguages.includes(code)
        ? selectedLanguages.filter((entry) => entry !== code)
        : [...selectedLanguages, code]
    );
  };

  return (
    <DialogPanel
      description="If none are selected, all languages will be shown in your feeds"
      onClose={onClose}
      title="Select content languages"
    >
      <View
        style={[
          styles.search,
          {
            backgroundColor: theme.cardBg,
            borderColor: theme.cardBorder,
            boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
          },
        ]}
      >
        <Search color={text.muted} size={16} />
        <TextInput
          accessibilityLabel="Search languages"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder="Search languages"
          placeholderTextColor={text.muted}
          style={[styles.searchInput, { color: text.foreground }]}
          value={search}
        />
        {search ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setSearch("")}
          >
            <X color={text.muted} size={14} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        style={{ marginTop: 12, maxHeight: height * 0.5 }}
      >
        {recentlyUsed.length > 0 ? (
          <View style={styles.group}>
            <Text style={[styles.groupTitle, { color: text.muted }]}>
              RECENTLY USED
            </Text>
            {recentlyUsed.map((option) => (
              <LanguageRow
                checked={selectedLanguages.includes(option.code)}
                key={`recent-${option.code}`}
                label={option.label}
                onPress={() => toggleLanguage(option.code)}
              />
            ))}
          </View>
        ) : null}
        <View>
          <Text style={[styles.groupTitle, { color: text.muted }]}>
            ALL LANGUAGES
          </Text>
          {filtered.length === 0 ? (
            <Text style={[styles.empty, { color: text.muted }]}>
              No languages found
            </Text>
          ) : (
            filtered.map((option) => (
              <LanguageRow
                checked={selectedLanguages.includes(option.code)}
                key={option.code}
                label={option.label}
                onPress={() => toggleLanguage(option.code)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </DialogPanel>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    paddingVertical: 24,
    textAlign: "center",
  },
  group: { marginBottom: 16 },
  groupTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 11,
    letterSpacing: 0.8,
    paddingBottom: 4,
    paddingHorizontal: 12,
  },
  row: { justifyContent: "space-between", paddingVertical: 10 },
  rowText: { flex: 1, fontSize: 14 },
  search: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
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
