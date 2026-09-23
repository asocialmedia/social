// Native port of web's FloatingPostComposer: the same modal on every
// breakpoint - a black/40 backdrop that closes on tap (Android back too),
// and a top-anchored apple-panel card (rounded 16, px-16 from the edges,
// 24px under the status bar) scrolling within 85% of the screen, holding
// the PostEditor. Closing keeps the draft (text, picks, attachments) like
// web; publishing clears it. The toast stack is re-mounted inside so
// composer toasts show above the modal layer.
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Toaster } from "@/components/feedback/toast";
import { APPLE_PANEL_TOKENS } from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { useAppTheme } from "@/theme";

import { useComposerStore } from "../state/composer-store";
import { PostEditor } from "./post-editor";

export function ComposerModal() {
  const { isDark } = useAppTheme();
  const { user } = useSessionContext();
  const isOpen = useComposerStore((state) => state.isOpen);
  const close = useComposerStore((state) => state.close);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;

  if (!isOpen || !user) {
    return null;
  }

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={close}
      statusBarTranslucent
      transparent
      visible
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.fill}
      >
        <Pressable
          accessibilityLabel="Close composer"
          onPress={close}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
        <View
          pointerEvents="box-none"
          style={[styles.anchor, { paddingTop: insets.top + 24 }]}
        >
          <View
            style={[
              styles.panel,
              {
                backgroundColor: panel.background,
                borderColor: panel.border,
                boxShadow: panel.shadows,
                maxHeight: window.height * 0.85,
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <PostEditor onPublished={close} />
            </ScrollView>
          </View>
        </View>
        <Toaster />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  anchor: {
    alignItems: "center",
    flex: 1,
    paddingHorizontal: 16,
  },
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  fill: {
    flex: 1,
  },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 672,
    overflow: "hidden",
    width: "100%",
  },
});
