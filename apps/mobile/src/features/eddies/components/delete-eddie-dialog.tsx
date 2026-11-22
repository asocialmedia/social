// "Delete Eddie?" confirmation, port of web's DeleteCommentDialog on the
// shadcn Dialog: black/80 overlay, centered panel-3d card (p-6, gap-4),
// title + description, and the footer stacked on phones (sm:flex-row) with
// the destructive Delete (spinner while pending) over the outline Cancel.
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { APPLE_PANEL_TOKENS, themeText } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

export function DeleteEddieDialog({
  deleting,
  onCancel,
  onConfirm,
  open,
}: {
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
  if (!open) {
    return null;
  }
  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.center}>
        <Pressable
          accessibilityLabel="Close"
          disabled={deleting}
          onPress={onCancel}
          style={[StyleSheet.absoluteFill, styles.overlay]}
        />
        <View
          accessibilityRole="alert"
          style={[
            styles.card,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: text.foreground }]}>
              Delete Eddie?
            </Text>
            <Text style={[styles.description, { color: text.muted }]}>
              Are you sure you want to delete this Eddie? This action cannot be
              undone.
            </Text>
          </View>
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={deleting}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: isDark ? "#7f1d1d" : "#dc2626" },
                pressed && styles.pressed,
              ]}
            >
              {deleting ? (
                <ActivityIndicator color="#ffffff" size={14} />
              ) : null}
              <Text style={[styles.buttonText, { color: "#ffffff" }]}>
                Delete
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={deleting}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: isDark ? "#1f1f1f" : "#f9f9f9",
                  borderColor: isDark
                    ? "rgba(255, 255, 255, 0.12)"
                    : "rgba(0, 0, 0, 0.12)",
                  borderWidth: 1,
                },
                pressed && styles.pressed,
                deleting && styles.dimmed,
              ]}
            >
              <Text style={[styles.buttonText, { color: text.foreground }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 8,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 16,
    maxWidth: 512,
    padding: 24,
    width: "100%",
  },
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
  },
  dimmed: {
    opacity: 0.5,
  },
  footer: {
    gap: 8,
  },
  header: {
    gap: 6,
  },
  overlay: {
    backgroundColor: "rgba(0, 0, 0, 0.8)",
  },
  pressed: {
    opacity: 0.9,
    transform: [{ translateY: 1 }],
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 18,
  },
});
