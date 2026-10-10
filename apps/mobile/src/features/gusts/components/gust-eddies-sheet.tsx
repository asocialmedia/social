import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  BackHandler,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { reelsPanel } from "@/components/media/gif-picker";
import { themeText } from "@/components/surface/recipes";
import { EddieThread } from "@/features/eddies/components/eddie-thread";
import { haptic } from "@/lib/haptics";
import { keyboardScreenTop } from "@/lib/keyboard-overlap";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import { eddieSheetDetent } from "../lib/eddie-sheet-detent";

const SPRING = { dampingRatio: 1, duration: 280, overshootClamping: true };

interface SheetProps {
  onClose: () => void;
  postId: string | null;
  previewProgress?: SharedValue<number>;
  viewerId: string | undefined;
  viewportHeight?: number;
}

export function GustEddiesSheet(props: SheetProps) {
  const window = useWindowDimensions();
  return props.postId ? (
    <OpenGustEddiesSheet
      {...props}
      key={props.postId}
      postId={props.postId}
      viewportHeight={props.viewportHeight ?? window.height}
    />
  ) : null;
}

// Expo UI's modal detents don't expose the visible RN viewport or keep the upper player interactive.
// This sheet stays in the Gust viewport so its independent scroll area and system bars stay correct.
function OpenGustEddiesSheet({
  onClose,
  postId,
  previewProgress,
  viewerId,
  viewportHeight,
}: SheetProps & { postId: string; viewportHeight: number }) {
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const panel = reelsPanel(isDark);
  const { muted } = themeText(isDark);
  const [expanded, setExpanded] = useState(false);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const height = Math.min(viewportHeight, keyboardTop ?? viewportHeight);
  const top = insets.top + 8;
  const sheetHeight = Math.max(0, height - top);
  const halfOffset = Math.max(0, height / 2 - top);
  const position = useSharedValue(viewportHeight);
  const origin = useSharedValue(halfOffset);
  const closing = useSharedValue(false);

  // One UI clock moves the panel and the playing video, including interrupted dismissals.
  useAnimatedReaction(
    () => position.get(),
    (offset) => {
      previewProgress?.set(
        Math.min(
          1,
          Math.max(0, (viewportHeight - top - offset) / (viewportHeight / 2))
        )
      );
    }
  );

  const dismiss = () => {
    Keyboard.dismiss();
    closing.set(true);
    position.set(
      withSpring(viewportHeight, SPRING, (finished) => {
        if (finished) {
          scheduleOnRN(onClose);
        }
      })
    );
  };
  const settle = (full: boolean) => {
    setExpanded(full);
    haptic("selection");
  };

  useEffect(() => {
    if (!closing.get()) {
      position.set(withSpring(expanded ? 0 : halfOffset, SPRING));
    }
  }, [closing, expanded, halfOffset, position]);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      dismiss();
      return true;
    });
    return () => back.remove();
  });
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (event) => {
        setKeyboardTop(
          keyboardScreenTop({
            bottomInset: insets.bottom,
            height: event.endCoordinates.height,
            platform: Platform.OS,
            screenHeight: Dimensions.get("screen").height,
            screenY: event.endCoordinates.screenY,
          })
        );
        setExpanded(true);
      }
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardTop(null)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom]);

  // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is the documented gesture-handler builder
  const pan = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      origin.set(position.get());
    })
    .onUpdate((event) => {
      position.set(
        Math.min(sheetHeight, Math.max(0, origin.get() + event.translationY))
      );
    })
    .onEnd((event) => {
      const detent = eddieSheetDetent(
        position.get(),
        event.velocityY,
        halfOffset
      );
      if (detent === "closed") {
        closing.set(true);
        scheduleOnRN(dismiss);
      } else {
        position.set(
          withSpring(detent === "full" ? 0 : halfOffset, {
            ...SPRING,
            velocity: event.velocityY,
          })
        );
        scheduleOnRN(settle, detent === "full");
      }
    })
    .onFinalize((_event, success) => {
      if (!success && !closing.get()) {
        position.set(withSpring(origin.get(), SPRING));
      }
    });
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: position.get() }],
  }));

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        styles.sheet,
        {
          backgroundColor: panel.background,
          borderColor: panel.border,
          boxShadow: panel.shadows,
          height: sheetHeight,
          top,
        },
        animated,
      ]}
      testID="gust-eddies-sheet"
    >
      <View
        style={{
          height: expanded ? sheetHeight : height / 2,
          paddingBottom: keyboardTop === null ? Math.max(insets.bottom, 12) : 8,
        }}
      >
        <View style={styles.header}>
          <GestureDetector gesture={pan}>
            <Animated.View>
              <Pressable
                accessibilityLabel={
                  expanded ? "Collapse eddies" : "Expand eddies"
                }
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => settle(!expanded)}
                style={styles.gripTouchTarget}
              >
                <View
                  style={[
                    styles.grip,
                    {
                      backgroundColor: isDark ? "#353638" : "#dedfe2",
                      borderColor: isDark ? "#111112" : "#bec1c8",
                      boxShadow: isDark
                        ? "inset 0 1px 1px rgba(255,255,255,0.32), inset 0 -1px 1px rgba(0,0,0,0.45)"
                        : "inset 0 1px 1px #ffffff, inset 0 -1px 1px rgba(0,0,0,0.12)",
                    },
                  ]}
                />
              </Pressable>
            </Animated.View>
          </GestureDetector>
          <Pressable
            accessibilityLabel="Close eddies"
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
          showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
          style={styles.scroll}
        >
          <EddieThread postId={postId} variant="reels" viewerId={viewerId} />
        </ScrollView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 16, paddingHorizontal: 16 },
  closeBtn: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    position: "absolute",
    right: 12,
    top: 6,
    width: 32,
  },
  grip: { borderRadius: 9999, borderWidth: 1, height: 6, width: 40 },
  gripTouchTarget: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 88,
  },
  header: { alignItems: "center", height: 44, justifyContent: "center" },
  scroll: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    zIndex: 60,
  },
});
