// Web's phone eddies drawer on the gusts page: a black/50 backdrop that
// fades in and closes on tap, and a `reels-panel` sheet at 75% height with
// rounded-t-3xl sliding up (0.28s, ease [0.32, 0.72, 0, 1]). A close row
// with the muted X, then the full thread in its reels variant. The sheet
// lifts with the keyboard so the composer stays visible while typing.
import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  Animated,
  Easing,
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

import { reelsPanel } from "@/components/media/gif-picker";
import { themeText } from "@/components/surface/recipes";
import { EddieThread } from "@/features/eddies/components/eddie-thread";
import { useAppTheme } from "@/theme";

const SHEET_EASE = Easing.bezier(0.32, 0.72, 0, 1);

export function GustEddiesSheet({
  onClose,
  postId,
  viewerId,
}: {
  onClose: () => void;
  postId: string | null;
  viewerId: string | undefined;
}) {
  const { isDark } = useAppTheme();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [progress] = useState(() => new Animated.Value(0));
  const [closing, setClosing] = useState(false);
  const open = postId !== null;
  const sheetHeight = Math.round(window.height * 0.75);

  useEffect(() => {
    if (!open) {
      return;
    }
    progress.setValue(0);
    const enter = Animated.timing(progress, {
      duration: 280,
      easing: SHEET_EASE,
      toValue: 1,
      useNativeDriver: true,
    });
    enter.start();
    return () => enter.stop();
  }, [open, progress]);

  const dismiss = () => {
    if (closing) {
      return;
    }
    setClosing(true);
    Animated.timing(progress, {
      duration: 280,
      easing: SHEET_EASE,
      toValue: 0,
      useNativeDriver: true,
    }).start(() => {
      setClosing(false);
      onClose();
    });
  };

  if (!open) {
    return null;
  }
  const panel = reelsPanel(isDark);
  const { muted } = themeText(isDark);

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={dismiss}
      statusBarTranslucent
      transparent
      visible
    >
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable
          accessibilityLabel="Close comments"
          onPress={dismiss}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        pointerEvents="box-none"
        style={styles.keyboard}
      >
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
              height: sheetHeight,
              paddingBottom: insets.bottom,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [sheetHeight, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.closeRow}>
            <Pressable
              accessibilityLabel="Close comments"
              accessibilityRole="button"
              hitSlop={6}
              onPress={dismiss}
              style={styles.closeBtn}
            >
              <X color={muted} size={16} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}
          >
            <EddieThread postId={postId} variant="reels" viewerId={viewerId} />
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  body: {
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  closeBtn: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  closeRow: {
    alignItems: "flex-end",
    paddingBottom: 4,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  keyboard: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scroll: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
});
