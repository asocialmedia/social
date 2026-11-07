// Web Spotlight's control bar at phone width: the Both/ASM/Bluesky network
// switcher and the Filters / Clear history action track, both built as a
// recessed `.segmented-3d` well holding raised keys, plus the "Show" filter
// menu the Filters key opens.
import { Image } from "expo-image";
import { Check, SlidersHorizontal, Trash2 } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import asmLogo from "@/assets/images/asm.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { panel3d } from "@/components/surface/recipes";
import { BlueskyIcon } from "@/features/feed/components/bluesky-icon";

import type { SearchKind, SearchSource } from "../lib/search-scope";
import {
  blueskySurface,
  chipRaised,
  segmentKey,
  segmentedTrack,
} from "./spotlight-recipes";
import type { SegmentSkin, SpotlightPalette } from "./spotlight-recipes";
import { BLUESKY_MARK } from "./spotlight-rows";

export const SOURCE_OPTIONS = [
  { compactLabel: "Both", label: "Both networks", value: "all" },
  { compactLabel: "ASM", label: "asocialmedia", value: "asm" },
  { compactLabel: "Bluesky", label: "Bluesky", value: "bluesky" },
] as const;

export const KIND_OPTIONS = [
  { label: "Everything", value: "all" },
  { label: "Accounts", value: "user" },
  { label: "Posts", value: "post" },
  { label: "Communities", value: "community" },
] as const;

function Track({
  children,
  grow,
  isDark,
  palette,
}: {
  children: ReactNode;
  grow?: boolean;
  isDark: boolean;
  palette: SpotlightPalette;
}) {
  const track = segmentedTrack(isDark, palette.blue);
  return (
    <Gradient3D
      colors={track.colors}
      radius={12}
      shadows={track.shadows}
      style={[styles.track, grow ? styles.trackGrow : null]}
    >
      {children}
    </Gradient3D>
  );
}

function Key({
  accessibilityLabel,
  active,
  children,
  grow,
  isDark,
  onPress,
  skin,
}: {
  accessibilityLabel: string;
  active: boolean;
  // Receives the raised key's ink, or null while the key is idle.
  children: (ink: string | null) => ReactNode;
  grow?: boolean;
  isDark: boolean;
  onPress: () => void;
  skin: SegmentSkin | null;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={grow ? styles.keyGrow : null}
    >
      {({ pressed }) => {
        if (skin) {
          const recipe = segmentKey(isDark, skin);
          return (
            <Gradient3D
              colors={recipe.colors}
              radius={8}
              shadows={recipe.shadows}
              style={[styles.key, pressed ? styles.keyPressed : null]}
            >
              <View style={styles.keyContent}>{children(recipe.text)}</View>
            </Gradient3D>
          );
        }
        return (
          <View style={[styles.key, pressed ? styles.keyPressed : null]}>
            <View style={styles.keyContent}>{children(null)}</View>
          </View>
        );
      }}
    </Pressable>
  );
}

function activeSourceSkin(source: SearchSource, blue: boolean): SegmentSkin {
  if (source === "asm") {
    return "orange";
  }
  if (source === "bluesky") {
    return "bluesky";
  }
  return blue ? "onBrand" : "neutral";
}

export function SourceSwitcher({
  isDark,
  onChange,
  palette,
  source,
}: {
  isDark: boolean;
  onChange: (source: SearchSource) => void;
  palette: SpotlightPalette;
  source: SearchSource;
}) {
  const idle = palette.blue ? "rgba(255, 255, 255, 0.8)" : palette.muted;
  return (
    <Track grow isDark={isDark} palette={palette}>
      {SOURCE_OPTIONS.map((option) => {
        const active = source === option.value;
        return (
          <Key
            accessibilityLabel={option.label}
            active={active}
            grow
            isDark={isDark}
            key={option.value}
            onPress={() => onChange(option.value)}
            skin={active ? activeSourceSkin(option.value, palette.blue) : null}
          >
            {(ink) => {
              const color = ink ?? idle;
              return (
                <>
                  {option.value === "asm" ? (
                    <Image
                      contentFit="contain"
                      source={asmLogo}
                      style={styles.logo}
                      tintColor={active ? "#ffffff" : undefined}
                    />
                  ) : null}
                  {option.value === "bluesky" ? (
                    <BlueskyIcon color={BLUESKY_MARK} size={14} />
                  ) : null}
                  <Text numberOfLines={1} style={[styles.keyText, { color }]}>
                    {option.compactLabel}
                  </Text>
                </>
              );
            }}
          </Key>
        );
      })}
    </Track>
  );
}

export function ActionTrack({
  canClearHistory,
  isDark,
  kind,
  onClearHistory,
  onToggleFilters,
  palette,
}: {
  canClearHistory: boolean;
  isDark: boolean;
  kind: SearchKind;
  onClearHistory: () => void;
  onToggleFilters: () => void;
  palette: SpotlightPalette;
}) {
  const idle = palette.blue ? "rgba(255, 255, 255, 0.85)" : palette.muted;
  const filtered = kind !== "all";
  let filterSkin: SegmentSkin | null = null;
  if (filtered) {
    filterSkin = palette.blue ? "onBrand" : "neutral";
  }
  return (
    <Track isDark={isDark} palette={palette}>
      <Key
        accessibilityLabel="Search filters"
        active={filtered}
        isDark={isDark}
        onPress={onToggleFilters}
        skin={filterSkin}
      >
        {(ink) => <SlidersHorizontal color={ink ?? idle} size={14} />}
      </Key>
      {canClearHistory ? (
        <Key
          accessibilityLabel="Clear history"
          active={false}
          isDark={isDark}
          onPress={onClearHistory}
          skin={null}
        >
          {() => <Trash2 color={idle} size={14} />}
        </Key>
      ) : null}
    </Track>
  );
}

export function FilterMenu({
  isDark,
  kind,
  onSelect,
  palette,
}: {
  isDark: boolean;
  kind: SearchKind;
  onSelect: (kind: SearchKind) => void;
  palette: SpotlightPalette;
}) {
  const panel = panel3d(isDark);
  const raised = chipRaised(isDark);
  const options = KIND_OPTIONS.filter(
    (option) => !palette.blue || option.value !== "community"
  );
  const body = (
    <>
      <Text style={[styles.menuTitle, { color: palette.foreground }]}>
        Show
      </Text>
      <View style={styles.menuOptions}>
        {options.map((option) => {
          const active = kind === option.value;
          let ink = palette.foreground;
          if (palette.blue) {
            ink = active ? "#0866df" : "rgba(255, 255, 255, 0.85)";
          } else if (active) {
            ink = raised.text;
          }
          const content = (
            <>
              <Text
                numberOfLines={1}
                style={[styles.optionText, { color: ink }]}
              >
                {option.label}
              </Text>
              {active ? <Check color={ink} size={14} strokeWidth={3} /> : null}
            </>
          );
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={option.value}
              onPress={() => onSelect(option.value)}
            >
              {({ pressed }) => {
                if (active) {
                  const recipe = palette.blue
                    ? segmentKey(isDark, "onBrand")
                    : raised;
                  return (
                    <Gradient3D
                      colors={recipe.colors}
                      radius={12}
                      shadows={recipe.shadows}
                      style={[
                        styles.option,
                        palette.blue ? null : styles.optionRaisedBorder,
                        palette.blue ? null : { borderColor: raised.border },
                        pressed ? styles.keyPressed : null,
                      ]}
                    >
                      {content}
                    </Gradient3D>
                  );
                }
                return (
                  <View
                    style={[
                      styles.option,
                      pressed ? { backgroundColor: palette.rowPressed } : null,
                    ]}
                  >
                    {content}
                  </View>
                );
              }}
            </Pressable>
          );
        })}
      </View>
    </>
  );
  if (palette.blue) {
    const surface = blueskySurface(isDark);
    return (
      <Gradient3D
        colors={surface.colors}
        radius={16}
        shadows={surface.shadows}
        style={[styles.menu, styles.menuBlue]}
      >
        {body}
      </Gradient3D>
    );
  }
  return (
    <View
      style={[
        styles.menu,
        styles.menuPanel,
        {
          backgroundColor: panel.background,
          borderColor: panel.border,
          boxShadow: panel.shadows,
        },
      ]}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  key: {
    alignItems: "center",
    borderRadius: 8,
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  keyContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
  },
  keyGrow: {
    flex: 1,
    minWidth: 0,
  },
  keyPressed: {
    transform: [{ translateY: 1 }],
  },
  keyText: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
  },
  logo: {
    height: 14,
    width: 14,
  },
  menu: {
    alignItems: "stretch",
    borderRadius: 16,
    justifyContent: "flex-start",
    padding: 10,
    width: 240,
  },
  menuBlue: {
    borderColor: "rgba(255, 255, 255, 0.6)",
    borderWidth: 1,
  },
  menuOptions: {
    gap: 6,
    marginTop: 8,
  },
  menuPanel: {
    borderWidth: 1,
  },
  menuTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 13,
    paddingHorizontal: 4,
  },
  option: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    height: 36,
    justifyContent: "flex-start",
    paddingHorizontal: 10,
  },
  optionRaisedBorder: {
    borderWidth: 1,
  },
  optionText: {
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 13,
  },
  track: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 2,
    height: 36,
    justifyContent: "flex-start",
    padding: 4,
  },
  trackGrow: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
});
