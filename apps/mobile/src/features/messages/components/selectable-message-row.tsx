import { Check, Reply } from "lucide-react-native";
import { memo } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { replyFeedback } from "@/features/messages/lib/message-gestures";
import {
  iconButton3d,
  sendButton,
} from "@/features/messages/lib/message-recipes";
import { useAppTheme } from "@/theme";

export const SelectableMessageRow = memo(
  ({
    children,
    id,
    mine,
    selected,
    selectionActive,
    onToggle,
    swipeId,
    swipeX,
  }: {
    children: ReactNode;
    id: string;
    mine: boolean;
    selected: boolean;
    selectionActive: boolean;
    onToggle: (id: string) => void;
    swipeId: SharedValue<string>;
    swipeX: SharedValue<number>;
  }) => {
    const { isDark } = useAppTheme();
    const neutral = iconButton3d(isDark);
    const accent = sendButton(isDark);
    const neutralBorder = isDark ? "#ffffff26" : "#0000001f";
    const selectionSpacing = mine ? styles.ownSelection : styles.peerSelection;
    const leadingEdge = useSharedValue(16);
    const reduceMotion = useReducedMotion();

    const movement = useAnimatedStyle(() => ({
      transform: [{ translateX: swipeId.get() === id ? swipeX.get() : 0 }],
    }));
    const affordance = useAnimatedStyle(() => {
      const feedback = replyFeedback(swipeId.get() === id ? swipeX.get() : 0);
      return {
        left: leadingEdge.get() - 12,
        opacity: feedback.opacity,
        transform: [
          { translateX: reduceMotion ? 0 : -12 * (1 - feedback.progress) },
          { scale: reduceMotion ? 1 : feedback.scale },
          { rotate: `${reduceMotion ? 0 : -16 * (1 - feedback.progress)}deg` },
        ],
      };
    });
    const readyRing = useAnimatedStyle(() => ({
      opacity: replyFeedback(swipeId.get() === id ? swipeX.get() : 0)
        .ringOpacity,
    }));
    return (
      <View testID={`message-${id}`} style={selected && styles.selected}>
        <Animated.View
          pointerEvents="none"
          testID="message-reply-affordance"
          style={[styles.reply, affordance]}
        >
          <Animated.View style={[styles.replyRing, readyRing]} />
          <Gradient3D
            colors={accent.restingGradient}
            shadows={accent.shadows}
            style={styles.replySurface}
          >
            <Reply size={17} color="#ffffff" strokeWidth={2.3} />
          </Gradient3D>
        </Animated.View>
        <Animated.View style={movement}>
          <Pressable
            accessible={selectionActive}
            accessibilityRole={selectionActive ? "checkbox" : undefined}
            accessibilityLabel={selectionActive ? "Select message" : undefined}
            accessibilityState={
              selectionActive ? { checked: selected } : undefined
            }
            onPress={selectionActive ? () => onToggle(id) : undefined}
            style={selectionActive ? selectionSpacing : undefined}
          >
            <View
              onLayout={(event) => {
                leadingEdge.set(event.nativeEvent.layout.x + (mine ? 16 : 52));
              }}
              style={mine ? styles.bodyMine : styles.bodyTheirs}
            >
              {children}
            </View>
          </Pressable>
        </Animated.View>
        {selectionActive ? (
          <View
            pointerEvents="none"
            testID={mine ? "message-selection-right" : "message-selection-left"}
            style={[
              styles.tickPosition,
              mine ? styles.tickRight : styles.tickLeft,
            ]}
          >
            <View
              style={[
                styles.tick,
                {
                  backgroundColor: selected ? "#ff9500" : neutral.background,
                  borderColor: selected ? "#aa3c00" : neutralBorder,
                  boxShadow: selected ? accent.shadows : neutral.shadows,
                },
              ]}
            >
              {selected ? (
                <Check size={13} color="#ffffff" strokeWidth={3} />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    );
  }
);

SelectableMessageRow.displayName = "SelectableMessageRow";

const styles = StyleSheet.create({
  bodyMine: { alignSelf: "flex-end" },
  bodyTheirs: { alignSelf: "flex-start" },
  ownSelection: { paddingRight: 16 },
  peerSelection: { paddingLeft: 16 },
  reply: { left: 0, marginTop: -15, position: "absolute", top: "50%" },
  replyRing: {
    backgroundColor: "#ff95001f",
    borderColor: "#ff950059",
    borderRadius: 20,
    borderWidth: 1,
    bottom: -4,
    left: -4,
    position: "absolute",
    right: -4,
    top: -4,
  },
  replySurface: { height: 30, width: 30 },
  selected: { backgroundColor: "rgba(255,149,0,0.10)" },
  tick: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  tickLeft: { left: 4 },
  tickPosition: { marginTop: -11, position: "absolute", top: "50%" },
  tickRight: { right: 4 },
});
