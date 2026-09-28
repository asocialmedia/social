// Native port of web's `components/hackernews/hn-search-bar.tsx`, the bar that
// sits under the sort tabs on mobile: a search field filling the row and a
// neutral `btn-3d-gray` pill that opens the type filter.
//
// Two web details that are easy to lose in the port and are kept here on
// purpose:
//   - The field is forced onto `background-alt`, not the default input fill, so
//     it reads as a field carved out of the page rather than a raised box.
//   - The pill's label is `hidden sm:inline`. Below 640px web shows the icon
//     and the chevron only, and a phone is always below that breakpoint, so the
//     label is not drawn here either. The pill carries the label to
//     accessibility instead, so the filter it holds is still announced.
import { ChevronDown, Search, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { btnGray, premiumInput } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

import type { HnFilter } from "../lib/hackernews-api";
import { HN_FILTER_OPTIONS } from "../lib/hackernews-api";
import { HnFilterMenu, HN_FILTER_ICONS } from "./hn-filter-menu";
import type { HnFilterAnchor } from "./hn-filter-menu";

export function HnSearchBar({
  filter,
  onFilterChange,
  onSearchChange,
  search,
}: {
  filter: HnFilter;
  onFilterChange: (filter: HnFilter) => void;
  onSearchChange: (value: string) => void;
  search: string;
}) {
  const { isDark, theme } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const [anchor, setAnchor] = useState<HnFilterAnchor | null>(null);
  const triggerRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);

  const activeFilter =
    HN_FILTER_OPTIONS.find((option) => option.value === filter) ??
    HN_FILTER_OPTIONS[0];
  const ActiveIcon = HN_FILTER_ICONS[activeFilter.value];

  const field = premiumInput(isDark, focused);
  const pill = btnGray(isDark);

  const handleClear = () => {
    onSearchChange("");
    inputRef.current?.focus();
  };

  const openMenu = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ height, width, x, y });
    });
  };

  return (
    <View style={styles.row}>
      <View style={styles.fieldWrap}>
        <Search color={theme.dividerText} size={16} style={styles.fieldIcon} />
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
          style={[
            styles.field,
            {
              backgroundColor: theme.containerBg,
              boxShadow: field.shadows,
              color: field.text,
            },
          ]}
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

      <Pressable
        accessibilityLabel={`Filter by ${activeFilter.label}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: anchor !== null }}
        hitSlop={6}
        onPress={openMenu}
        ref={triggerRef}
      >
        {({ pressed }) => {
          const tone = pressed ? pill.pressed : pill.resting;
          return (
            <Gradient3D
              colors={tone.colors}
              radius={9999}
              shadows={tone.shadows}
              style={styles.pill}
            >
              <ActiveIcon color={tone.text} size={14} />
              <ChevronDown color={tone.text} size={12} />
            </Gradient3D>
          );
        }}
      </Pressable>

      <HnFilterMenu
        anchor={anchor}
        filter={filter}
        onClose={() => setAnchor(null)}
        onSelect={onFilterChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clear: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 24,
  },
  field: {
    borderCurve: "continuous",
    borderRadius: 12,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    height: 40,
    paddingLeft: 36,
    paddingRight: 32,
    width: "100%",
  },
  fieldIcon: {
    left: 12,
    position: "absolute",
    top: 12,
  },
  fieldWrap: {
    flex: 1,
    height: 40,
    justifyContent: "center",
    minWidth: 0,
    position: "relative",
  },
  pill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
    width: 56,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
