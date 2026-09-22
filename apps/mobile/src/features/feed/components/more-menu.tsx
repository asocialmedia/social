// Post overflow menu as a bottom sheet. Carries the actions that work
// through existing REST endpoints or client-side state: Share (sheet),
// Not interested (session hide + Undo), and alt-text reveal. Owner and
// moderation flows (Delete, Moderation, Edit tags, Share-to-feed) run
// through Next server actions with no REST equivalent, so they are absent
// until backend endpoints exist for them - no dead entries.
import { EyeOff, Image as ImageIcon, Share2 } from "lucide-react-native";
import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import type { FeedPost } from "../lib/feed-types";

export type MoreAction =
  | { type: "hide" }
  | { type: "share" }
  | { type: "toggle-alt" };

interface MoreMenuProps {
  onAction: (action: MoreAction) => void;
  onClose: () => void;
  post: FeedPost | null;
  showingAlt: boolean;
}

function MenuRow({
  destructive,
  icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && {
          backgroundColor: isDark
            ? "rgba(255, 255, 255, 0.08)"
            : "rgba(0, 0, 0, 0.05)",
        },
      ]}
    >
      {icon}
      <Text
        style={[
          styles.rowLabel,
          { color: destructive ? "#dc2626" : theme.inputText },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function MoreMenu({
  onAction,
  onClose,
  post,
  showingAlt,
}: MoreMenuProps) {
  const { isDark, theme } = useAppTheme();
  const fire = (action: MoreAction) => {
    onClose();
    onAction(action);
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={post !== null}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={() => {
            /* taps on the sheet must not bubble to the backdrop */
          }}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
            },
          ]}
        >
          <View style={styles.handle} />
          <MenuRow
            icon={<Share2 color={theme.dividerText} size={16} />}
            label="Share post"
            onPress={() => fire({ type: "share" })}
          />
          <MenuRow
            destructive
            icon={<EyeOff color="#dc2626" size={16} />}
            label="Not interested"
            onPress={() => fire({ type: "hide" })}
          />
          <MenuRow
            icon={<ImageIcon color={theme.dividerText} size={16} />}
            label={showingAlt ? "Hide alt text" : "Show alt text"}
            onPress={() => fire({ type: "toggle-alt" })}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    flex: 1,
    justifyContent: "flex-end",
  },
  handle: {
    alignSelf: "center",
    backgroundColor: "rgba(128, 128, 128, 0.5)",
    borderRadius: 9999,
    height: 4,
    marginBottom: 8,
    width: 40,
  },
  row: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  rowLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingBottom: 24,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
});
