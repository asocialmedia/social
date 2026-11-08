import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { keyboardOverlap } from "@/lib/layout/keyboard-overlap";

// Report the whole occluded area to the thread, including the keyboard lift.
// Resized Android windows already end at the keyboard and need no extra lift.
export function ComposerAnchor({
  children,
  keyboardTop,
  onHeightChange,
  viewportBottom,
}: PropsWithChildren<{
  keyboardTop: number | null;
  onHeightChange?: (height: number) => void;
  viewportBottom: number;
}>) {
  return (
    <View
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[
        styles.anchor,
        { paddingBottom: keyboardOverlap(viewportBottom, keyboardTop) },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { bottom: 0, left: 0, position: "absolute", right: 0, zIndex: 40 },
});
