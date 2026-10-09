// Native port of web's `components/settings/settings-search.tsx`: a query
// field with a dropdown of matching settings entries, each tagged with the tab
// it lives in. Selecting one switches to that tab and scrolls to the section.
import { Search, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { premiumInput, themeText } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

import { SETTINGS_CATALOG, TAB_LABELS } from "../lib/settings-scroll";
import type { SettingsTab } from "../lib/settings-tabs";

interface SettingsSearchProps {
  onNavigate: (tab: SettingsTab, sectionId?: string) => void;
}

export function SettingsSearch({ onNavigate }: SettingsSearchProps) {
  const { isDark, theme } = useAppTheme();
  const text = themeText(isDark);
  const field = premiumInput(isDark, false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return SETTINGS_CATALOG.filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) ||
        entry.keywords.some((keyword) => keyword.includes(q))
    ).slice(0, 8);
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const showPanel = open && results.length > 0;
  const showEmpty = open && Boolean(query.trim()) && results.length === 0;

  return (
    <View style={styles.root}>
      {/* Android does not paint an inset box-shadow on a TextInput, so the
          premium-input recipe rides a wrapper View, matching every other
          field in the app. */}
      <View
        style={[
          styles.inputWrap,
          {
            backgroundColor: field.background,
            boxShadow: field.shadows,
          },
        ]}
      >
        <Search color={theme.dividerText} size={16} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => {
            setQuery(value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search settings"
          placeholderTextColor={field.placeholder}
          style={[styles.input, { color: field.text }]}
          value={query}
        />
        {query ? (
          <Pressable
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => setQuery("")}
            style={styles.clear}
          >
            <X color={theme.dividerText} size={14} />
          </Pressable>
        ) : null}
      </View>

      {showPanel ? (
        <View
          style={[
            styles.panel,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          {results.map((result) => (
            <Pressable
              accessibilityRole="button"
              key={result.id}
              onPress={() => {
                close();
                onNavigate(result.tab, result.sectionId);
              }}
              style={({ pressed }) => [
                styles.resultRow,
                pressed ? { backgroundColor: theme.containerBg } : null,
              ]}
            >
              <View style={styles.minWidthZero}>
                <Text style={[styles.resultLabel, { color: text.foreground }]}>
                  {result.label}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.resultDesc, { color: text.muted }]}
                >
                  {result.description}
                </Text>
              </View>
              <View
                style={[
                  styles.tabTag,
                  {
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.05)",
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.tabTagText, { color: text.muted }]}>
                  {TAB_LABELS[result.tab]}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {showEmpty ? (
        <View
          style={[
            styles.panel,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <View style={styles.empty}>
            <Text style={[styles.resultLabel, { color: text.foreground }]}>
              No settings found
            </Text>
            <Text style={[styles.resultDesc, { color: text.muted }]}>
              Nothing matches &quot;{query}&quot;, try something else
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  empty: { alignItems: "center", gap: 4, padding: 16 },
  input: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minWidth: 0,
    padding: 0,
  },
  inputWrap: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    position: "relative",
  },
  minWidthZero: { flexShrink: 1, minWidth: 0 },
  panel: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    elevation: 12,
    gap: 2,
    left: 0,
    padding: 6,
    position: "absolute",
    right: 0,
    top: "100%",
    zIndex: 50,
  },
  resultDesc: { fontFamily: "SofiaProReg", fontSize: 12 },
  resultLabel: { fontFamily: "SofiaProMed", fontSize: 14 },
  resultRow: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  root: { position: "relative", zIndex: 50 },
  tabTag: {
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tabTagText: {
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
});
