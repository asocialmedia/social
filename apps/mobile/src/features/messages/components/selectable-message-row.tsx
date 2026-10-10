import { Check, Reply } from "lucide-react-native";
import { memo } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

import { useAppTheme } from "@/theme";

export const SelectableMessageRow = memo(
  ({
    children,
    id,
    selected,
    selectionActive,
    onToggle,
    swipeId,
    swipeX,
  }: {
    children: ReactNode;
    id: string;
    selected: boolean;
    selectionActive: boolean;
    onToggle: (id: string) => void;
    swipeId: SharedValue<string>;
    swipeX: SharedValue<number>;
  }) => {
    const { isDark } = useAppTheme();
    const neutralBorder = isDark ? "#666666" : "#aaaaaa";

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
          >
            {children}
          </Pressable>
        </Animated.View>
        {selectionActive ? (
          <View pointerEvents="none" style={styles.tickPosition}>
            <View
              style={[
                styles.tick,
                {
                  backgroundColor: selected ? "#ff9500" : "transparent",
                  borderColor: selected ? "#ff9500" : neutralBorder,
                },
              ]}
            >
              {selected ? (
                <Check size={12} color="#ffffff" strokeWidth={3} />
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
  reply: { left: 24, marginTop: -10, position: "absolute", top: "50%" },
  selected: { backgroundColor: "rgba(255,149,0,0.10)" },
  tick: {
    alignItems: "center",
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: "center",
    width: 18,
  },
  tickPosition: { left: 2, marginTop: -9, position: "absolute", top: "50%" },
});
