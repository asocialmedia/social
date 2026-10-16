import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAppTheme } from "@/theme";

import { IconButton3D } from "./icon-button-3d";
import { panel3d } from "./recipes";

export function DialogPanel({
  children,
  description,
  onClose,
  title,
  busy = false,
}: {
  children: ReactNode;
  description: string;
  onClose: () => void;
  title: string;
  busy?: boolean;
}) {
  const { isDark, theme } = useAppTheme();
  const panel = panel3d(isDark);
  return (
    <Modal
      animationType="fade"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      visible
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.root}
      >
        <Pressable
          accessibilityLabel="Close dialog"
          disabled={busy}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View
            accessibilityViewIsModal
            style={[
              styles.panel,
              {
                backgroundColor: panel.background,
                borderColor: panel.border,
                boxShadow: panel.shadows,
              },
            ]}
          >
            <View style={styles.heading}>
              <View style={styles.copy}>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: theme.inputText }]}
                >
                  {title}
                </Text>
                <Text
                  style={[styles.description, { color: theme.dividerText }]}
                >
                  {description}
                </Text>
              </View>
              <IconButton3D
                accessibilityLabel="Close dialog"
                disabled={busy}
                icon={X}
                onPress={onClose}
                size={32}
              />
            </View>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1, minWidth: 0 },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  heading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  panel: {
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 440,
    padding: 20,
    width: "100%",
  },
  root: { backgroundColor: "rgba(0,0,0,0.55)", flex: 1 },
  scroll: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: 16,
    paddingVertical: 48,
  },
  title: { fontFamily: "SofiaProBold", fontSize: 20 },
});
