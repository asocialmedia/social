// Native port of the DropdownMenu half of web's
// `components/hackernews/hn-search-bar.tsx`: an anchored popover on the filter
// pill, laid out from the trigger's measured rect rather than a sheet, so it
// sits under the pill with its right edge on the pill's right edge and flips
// above when there is no room below (web's `align="end"` + collision flip).
//
// Geometry is copied from web rather than invented: `apple-panel min-w-44 p-1.5`
// over a 1px border, items at `gap-2.5 px-2.5 py-2` around a 20px text-sm line
// (36px tall), and the active item on `bg-orange-500/10` in orange ink with a
// Check on the right. The open/close is the same tw-animate entrance the other
// native popovers use: fade, zoom from 95%, 8px slide from the trigger side.
import {
  Activity,
  Briefcase,
  Check,
  HelpCircle,
  Newspaper,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useAppTheme,
  APPLE_PANEL_SHADOWS,
  APPLE_PANEL_SHADOWS_DARK,
} from "@/theme";

import { HN_FILTER_OPTIONS } from "../lib/hackernews-api";
import type { HnFilter } from "../lib/hackernews-api";

// The glyph each filter draws, keyed by the id the API takes. Web keeps this on
// the option itself; the option list stays free of react-native so the api lib
// stays testable, so the mapping lives with the panel that draws it.
export const HN_FILTER_ICONS: Record<
  HnFilter,
  ComponentType<{ color?: string; size?: number }>
> = {
  all: Newspaper,
  ask: HelpCircle,
  job: Briefcase,
  show: Newspaper,
  story: Activity,
};

// Trigger rect in window coordinates, as more-menu's MenuAnchor.
export interface HnFilterAnchor {
  height: number;
  width: number;
  x: number;
  y: number;
}

// sideOffset 4, content p-1.5 inside a 1px border, py-2 items.
const SIDE_OFFSET = 4;
const PANEL_PADDING = 6;
const PANEL_BORDER = 1;
const ITEM_HEIGHT = 36;
const EDGE_MARGIN = 8;
// tw-animate-css defaults: 150ms, `ease`.
const ANIM_MS = 150;
const CSS_EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

// `.apple-panel`, light + dark (web passes the class with shadow-none, so the
// panel surface is drawn but the floating layer supplies the depth).
const PANEL_LIGHT = {
  background: "#f3f4f6",
  border: "rgba(0, 0, 0, 0.12)",
  shadows: APPLE_PANEL_SHADOWS,
} as const;
const PANEL_DARK = {
  background: "#171717",
  border: "rgba(255, 255, 255, 0.12)",
  shadows: APPLE_PANEL_SHADOWS_DARK,
} as const;

export function HnFilterMenu({
  anchor,
  filter,
  onClose,
  onSelect,
}: {
  anchor: HnFilterAnchor | null;
  filter: HnFilter;
  onClose: () => void;
  onSelect: (filter: HnFilter) => void;
}) {
  const { isDark } = useAppTheme();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [progress] = useState(() => new Animated.Value(0));
  const [closing, setClosing] = useState(false);
  const open = anchor !== null;

  useEffect(() => {
    if (!open) {
      return;
    }
    progress.setValue(0);
    const enter = Animated.timing(progress, {
      duration: ANIM_MS,
      easing: CSS_EASE,
      toValue: 1,
      useNativeDriver: true,
    });
    enter.start();
    return () => {
      enter.stop();
    };
  }, [open, progress]);

  const dismiss = (after?: () => void) => {
    if (closing) {
      return;
    }
    setClosing(true);
    Animated.timing(progress, {
      duration: ANIM_MS,
      easing: CSS_EASE,
      toValue: 0,
      useNativeDriver: true,
    }).start(() => {
      setClosing(false);
      onClose();
      after?.();
    });
  };

  if (!anchor) {
    return null;
  }

  const panel = isDark ? PANEL_DARK : PANEL_LIGHT;
  const panelHeight =
    HN_FILTER_OPTIONS.length * ITEM_HEIGHT +
    PANEL_PADDING * 2 +
    PANEL_BORDER * 2;
  const below = anchor.y + anchor.height + SIDE_OFFSET;
  const roomBelow = window.height - insets.bottom - EDGE_MARGIN - below;
  const side = roomBelow >= panelHeight ? "bottom" : "top";
  const top =
    side === "bottom"
      ? below
      : Math.max(
          insets.top + EDGE_MARGIN,
          anchor.y - SIDE_OFFSET - panelHeight
        );
  // align="end": the panel's right edge sits on the trigger's right edge.
  const right = Math.max(EDGE_MARGIN, window.width - (anchor.x + anchor.width));
  // slide-in-from-top-2 (bottom side) / slide-in-from-bottom-2 (top side).
  const slideFrom = side === "bottom" ? -8 : 8;
  const accent = isDark ? "#fb923c" : "#ea580c";

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={() => dismiss()}
      statusBarTranslucent
      transparent
      visible
    >
      <Pressable
        accessibilityLabel="Close filter menu"
        onPress={() => dismiss()}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        accessibilityRole="menu"
        style={[
          styles.panel,
          {
            backgroundColor: panel.background,
            borderColor: panel.border,
            boxShadow: panel.shadows,
            opacity: progress,
            right,
            top,
            transform: [
              {
                translateY: closing
                  ? 0
                  : progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [slideFrom, 0],
                    }),
              },
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.95, 1],
                }),
              },
            ],
            transformOrigin: side === "bottom" ? "top right" : "bottom right",
          },
        ]}
      >
        {HN_FILTER_OPTIONS.map((option) => {
          const selected = option.value === filter;
          const Icon = HN_FILTER_ICONS[option.value];
          const defaultColor = isDark ? "#eeeeee" : "#202020";
          const itemColor = selected ? accent : defaultColor;
          return (
            <Pressable
              accessibilityLabel={option.label}
              accessibilityRole="menuitem"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => {
                dismiss(() => onSelect(option.value));
              }}
              style={({ pressed }) => [
                styles.item,
                selected && { backgroundColor: "rgba(249, 115, 22, 0.1)" },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Icon color={itemColor} size={16} />
              <Text
                style={[
                  styles.itemLabel,
                  {
                    color: itemColor,
                    fontFamily: selected ? "SofiaProBold" : "SofiaProReg",
                  },
                ]}
              >
                {option.label}
              </Text>
              {selected ? <Check color={accent} size={16} /> : null}
            </Pressable>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  item: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    height: ITEM_HEIGHT,
    paddingHorizontal: 10,
  },
  itemLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  panel: {
    borderRadius: 12,
    borderWidth: PANEL_BORDER,
    minWidth: 176,
    padding: PANEL_PADDING,
    position: "absolute",
  },
});
