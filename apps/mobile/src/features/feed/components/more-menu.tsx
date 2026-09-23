// Post overflow menu: 1:1 native port of web's PostMoreButton dropdown
// (posts/actions/post-more-button.tsx on the shadcn DropdownMenu). A
// panel-3d popover anchored under the `...` trigger, aligned to its right
// edge with a 4px offset, flipping above when there is no room below. It
// opens with the Radix/tw-animate entrance (fade, zoom from 95%, 8px slide
// from the trigger side) and closes with the fade + zoom out. Items use the
// `pill-3d-hover` treatment while pressed.
//
// Entries follow web's rules: Not interested (signed in, not the author),
// Show/Hide alt (only when an attachment is described), Show/Hide captions
// (posts with video, not moderated). Share to feed, Moderation, Edit tags
// and Delete run through Next server actions with no REST equivalent, so
// they stay out until endpoints exist - no dead entries.
import { Captions, EyeOff } from "lucide-react-native";
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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  APPLE_PANEL_SHADOWS,
  APPLE_PANEL_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import type { FeedPost } from "../lib/feed-types";

export type MoreAction =
  | { type: "delete" }
  | { type: "hide" }
  | { type: "toggle-alt" }
  | { type: "toggle-captions" };

// Trigger rect in window coordinates (measureInWindow).
export interface MenuAnchor {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface MoreMenuEntry {
  action: MoreAction;
  // Web's `text-destructive` item (the eddie row's Delete).
  destructive?: boolean;
  icon: ComponentType<{ color?: string; size?: number }>;
  label: string;
}

// Web's entry list for a post, in web's order.
export function buildMoreEntries(options: {
  post: FeedPost;
  showCaptions: boolean;
  showingAlt: boolean;
  viewerId?: string | null;
}): MoreMenuEntry[] {
  const { post, showCaptions, showingAlt, viewerId } = options;
  const attachments = post.attachments ?? [];
  const entries: MoreMenuEntry[] = [];
  if (viewerId && viewerId !== post.user?.id) {
    entries.push({
      action: { type: "hide" },
      icon: EyeOff,
      label: "Not interested",
    });
  }
  if (attachments.some((media) => media?.altText)) {
    entries.push({
      action: { type: "toggle-alt" },
      icon: Captions,
      label: showingAlt ? "Hide alt" : "Show alt",
    });
  }
  if (!post.moderated && attachments.some((media) => media?.type === "VIDEO")) {
    entries.push({
      action: { type: "toggle-captions" },
      icon: Captions,
      label: showCaptions ? "Hide captions" : "Show captions",
    });
  }
  return entries;
}

// `.panel-3d` on hsl(var(--background-alt)).
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

// `.pill-3d-hover:hover`, light + dark.
const ITEM_PRESSED_LIGHT = {
  color: "#1c1f26",
  gradient: ["#e4e7ec", "#c6ccd5"],
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1.5px 2px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.06)",
} as const;
const ITEM_PRESSED_DARK = {
  color: "#ffffff",
  gradient: ["#8f96a3", "#5c6370"],
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)",
} as const;

// --popover-foreground, light + dark.
const ITEM_TEXT_LIGHT = "#202020";
const ITEM_TEXT_DARK = "#eeeeee";

// Geometry: sideOffset 4, content p-1.5 inside a 1px border, items py-2
// around a 20px text-sm line. Height is computed up front so the side flip
// needs no measuring pass.
const SIDE_OFFSET = 4;
const PANEL_PADDING = 6;
const PANEL_BORDER = 1;
const ITEM_HEIGHT = 36;
const EDGE_MARGIN = 8;
// tw-animate-css defaults: 150ms, `ease`.
const ANIM_MS = 150;
const CSS_EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

function MenuItem({
  entry,
  isDark,
  onSelect,
}: {
  entry: MoreMenuEntry;
  isDark: boolean;
  onSelect: () => void;
}) {
  const pressedTone = isDark ? ITEM_PRESSED_DARK : ITEM_PRESSED_LIGHT;
  let restingText: string = isDark ? ITEM_TEXT_DARK : ITEM_TEXT_LIGHT;
  if (entry.destructive) {
    restingText = isDark ? "#ff6b6b" : "#dc2626";
  }
  const Icon = entry.icon;
  return (
    <Pressable
      accessibilityLabel={entry.label}
      accessibilityRole="menuitem"
      onPress={onSelect}
    >
      {({ pressed }) => (
        <View style={styles.item}>
          {/* Mounted fresh on press (a shadow added to an existing view
              draws square on Android), with the recipe's inset lip kept
              above the gradient. */}
          {pressed ? (
            <Gradient3D
              colors={pressedTone.gradient}
              radius={6}
              shadows={pressedTone.shadows}
              style={styles.itemFill}
            />
          ) : null}
          <Icon color={pressed ? pressedTone.color : restingText} size={16} />
          <Text
            style={[
              styles.itemLabel,
              { color: pressed ? pressedTone.color : restingText },
            ]}
          >
            {entry.label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function MoreMenu({
  anchor,
  entries,
  onAction,
  onClose,
}: {
  anchor: MenuAnchor | null;
  entries: MoreMenuEntry[];
  onAction: (action: MoreAction) => void;
  onClose: () => void;
}) {
  const { isDark } = useAppTheme();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [progress] = useState(() => new Animated.Value(0));
  const [closing, setClosing] = useState(false);
  const open = anchor !== null && entries.length > 0;

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

  if (!open) {
    return null;
  }

  const panel = isDark ? PANEL_DARK : PANEL_LIGHT;
  const panelHeight =
    entries.length * ITEM_HEIGHT + PANEL_PADDING * 2 + PANEL_BORDER * 2;
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
  // slide-in-from-top-2 (bottom side) / slide-in-from-bottom-2 (top side);
  // the exit only fades and zooms, so the slide is tied to the entrance.
  const slideFrom = side === "bottom" ? -8 : 8;

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
        accessibilityLabel="Close menu"
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
        {entries.map((entry) => (
          <MenuItem
            entry={entry}
            isDark={isDark}
            key={entry.action.type}
            onSelect={() => {
              // Web runs the item's handler on click while the menu animates
              // out; here the action lands once the exit finishes so the
              // list update never re-renders under a half-closed panel.
              dismiss(() => onAction(entry.action));
            }}
          />
        ))}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  item: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 12,
    height: ITEM_HEIGHT,
    paddingHorizontal: 8,
  },
  itemFill: {
    borderRadius: 6,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  itemLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 20,
  },
  panel: {
    borderRadius: 12,
    borderWidth: PANEL_BORDER,
    minWidth: 128,
    padding: PANEL_PADDING,
    position: "absolute",
  },
});
