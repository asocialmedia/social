// Native port of web's `components/hackernews/hn-search-bar.tsx`, minus the
// type-filter dropdown (removed across web and mobile): a single search field
// filling the row.
//
// The field takes the same raised `premium-input` surface every other field in
// the app uses (one step above the page, with the 3D dual border and inner
// lip), so it reads as a real input rather than a box carved out of the page.
// The magnifier rides the field's own flex row rather than being absolutely
// positioned over it, which is what made it invisible on Android.
import { Search, X } from "lucide-react-native";
import { useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { premiumInput } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

export function HnSearchBar({
  onSearchChange,
  search,
}: {
  onSearchChange: (value: string) => void;
  search: string;
}) {
  const { isDark, theme } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);

  const field = premiumInput(isDark, focused);

  const handleClear = () => {
    onSearchChange("");
    inputRef.current?.focus();
  };

  return (
    <View
      style={[
        styles.fieldWrap,
        { backgroundColor: field.background, boxShadow: field.shadows },
      ]}
    >
      <Search color={theme.dividerText} size={16} />
      <TextInput
        accessibilityLabel="Search HackerNews stories"
        autoCapitalize="none"
        autoComplete="off"
        onBlur={() => {
          setFocused(false);
        }}
        onChangeText={onSearchChange}
        onFocus={() => {
          setFocused(true);
        }}
        placeholder="Search stories..."
        placeholderTextColor={field.placeholder}
        ref={inputRef}
        returnKeyType="search"
        style={[styles.field, { color: field.text }]}
        value={search}
      />
      {search ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={10}
          onPress={handleClear}
          style={styles.clear}
        >
          <X color={theme.dividerText} size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: {
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    height: 40,
    minWidth: 0,
    padding: 0,
  },
  fieldWrap: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    height: 40,
    paddingHorizontal: 12,
    width: "100%",
  },
});
