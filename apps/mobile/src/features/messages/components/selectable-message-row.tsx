import { Check, Reply } from "lucide-react-native";
import { memo } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

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

    const movement = useAnimatedStyle(() => ({
      transform: [{ translateX: swipeId.get() === id ? swipeX.get() : 0 }],
    }));
    const affordance = useAnimatedStyle(() => ({
      opacity: swipeId.get() === id ? Math.min(1, swipeX.get() / 56) : 0,
    }));
    return (
      <View testID={`message-${id}`} style={selected && styles.selected}>
        <Animated.View pointerEvents="none" style={[styles.reply, affordance]}>
          <Reply size={20} color="#ff9500" />
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
            {children}
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
  ownSelection: { paddingRight: 16 },
  peerSelection: { paddingLeft: 16 },
  reply: { left: 24, marginTop: -10, position: "absolute", top: "50%" },
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
