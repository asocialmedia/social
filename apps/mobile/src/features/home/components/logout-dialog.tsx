// 1:1 native port of web LogoutDialog
// (components/layouts/dialogs/logout-dialog.tsx): the orange 3D icon tile,
// a fresh joke per opening, the sign-out copy, and Cancel + red Logout.
// A fresh joke is picked in an effect (not during render) so the React
// Compiler has no render-phase setState to complain about.
import { LinearGradient } from "expo-linear-gradient";
import { LogOut } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import { getRandomJoke } from "./logout-jokes";

interface LogoutDialogProps {
  onClose: () => void;
  onLogout: () => void;
  open: boolean;
}

const LOGOUT_BUTTON_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(150, 30, 30, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

export function LogoutDialog({ onClose, onLogout, open }: LogoutDialogProps) {
  const { isDark, theme } = useAppTheme();
  const [joke, setJoke] = useState(getRandomJoke());

  useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect -- a fresh joke per opening is event-driven state, not derivable during render
      setJoke(getRandomJoke());
    }
  }, [open]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={() => {
            /* taps on the card must not bubble to the backdrop */
          }}
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
            },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <LinearGradient
                colors={["#ff9500", "#e65500"]}
                end={{ x: 0.5, y: 1 }}
                start={{ x: 0.5, y: 0 }}
                style={styles.iconTile}
              >
                <LogOut color="#ffffff" size={14} />
              </LinearGradient>
              <Text style={[styles.title, { color: theme.inputText }]}>
                Leaving so soon?
              </Text>
            </View>
            <Text style={[styles.joke, { color: theme.dividerText }]}>
              {joke}
            </Text>
          </View>
          <View style={styles.body}>
            <Text style={[styles.copy, { color: theme.inputText }]}>
              You&apos;ll be signed out of your account. Come back anytime.
            </Text>
            <View style={styles.actions}>
              <Pressable hitSlop={6} onPress={onClose}>
                <Text style={[styles.cancel, { color: theme.dividerText }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable onPress={onLogout}>
                {({ pressed }) => (
                  <View
                    style={[
                      styles.logoutBtn,
                      { boxShadow: LOGOUT_BUTTON_SHADOWS },
                      pressed && styles.pressedShift,
                    ]}
                  >
                    <LinearGradient
                      colors={["#f87171", "#dc2626"]}
                      end={{ x: 0.5, y: 1 }}
                      start={{ x: 0.5, y: 0 }}
                      style={styles.logoutGradient}
                    >
                      <Text style={styles.logoutText}>Logout</Text>
                    </LinearGradient>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 20,
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  body: {
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  cancel: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 400,
    overflow: "hidden",
    width: "100%",
  },
  copy: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
  },
  header: {
    borderBottomWidth: 1,
    borderColor: "rgba(128, 128, 128, 0.35)",
    gap: 4,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  iconTile: {
    alignItems: "center",
    borderRadius: 8,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  joke: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  logoutBtn: {
    borderRadius: 9999,
  },
  logoutGradient: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  logoutText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
