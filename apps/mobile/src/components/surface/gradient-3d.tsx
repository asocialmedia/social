// A gradient surface that keeps the web 3D recipe's dual border intact.
//
// On web a `box-shadow` list paints its inset layers (the bright inner lip)
// above the element's gradient background and below its content. React
// Native paints inset shadows on the view's own background, so a
// LinearGradient child covers them and only the outer ring survives - the
// "dual border" collapses to one. This draws the recipe the web way: outer
// layers on the container, the gradient, the inset layers on an overlay
// above it, then the content.
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { splitBoxShadow } from "./box-shadow";

// The four per-corner radius keys, declared structurally rather than imported:
// components/ must not depend on a feature, and @/features/messages/lib holds an
// identical shape (message-bubble-shape.ts) for the same reason. TypeScript
// treats the two as one type without an import edge.
interface BubbleCorners {
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
}

export function Gradient3D({
  borderRadius,
  children,
  colors,
  direction = "vertical",
  radius = 9999,
  shadows,
  style,
}: {
  children?: ReactNode;
  colors: readonly [string, string, ...string[]];
  // Per-corner radii, for a surface whose corners are not all equal. A grouped
  // message bubble tightens two corners on its thread edge and leaves the others
  // full, which a single `radius` cannot express. They are spread as sibling style
  // properties because RN's `borderRadius` is the shorthand scalar, not the object
  // shorthand CSS uses.
  borderRadius?: BubbleCorners;
  // "vertical" runs top to bottom; "horizontal" runs left to right. Web
  // writes this as bg-linear-to-r / bg-linear-to-b on the same element.
  direction?: "horizontal" | "vertical";
  radius?: number;
  // A full CSS box-shadow list, inset and outer layers mixed, as on web.
  shadows: string;
  // Size and content layout; the surface itself owns radius and shadows.
  style?: StyleProp<ViewStyle>;
}) {
  const { inset, outer } = splitBoxShadow(shadows);
  const isHorizontal = direction === "horizontal";
  // `radius` becomes the uniform case of the same four keys, so every layer below
  // applies one shape and a per-corner surface cannot drift out of sync with its
  // own gradient and overlay.
  const corners: BubbleCorners = borderRadius ?? {
    borderBottomLeftRadius: radius,
    borderBottomRightRadius: radius,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
  };
  return (
    <View
      style={[
        styles.surface,
        style,
        corners,
        outer ? { boxShadow: outer } : null,
      ]}
    >
      <LinearGradient
        colors={colors}
        end={isHorizontal ? { x: 1, y: 0 } : { x: 0.5, y: 1 }}
        pointerEvents="none"
        start={isHorizontal ? { x: 0, y: 0 } : { x: 0.5, y: 0 }}
        style={[StyleSheet.absoluteFill, corners]}
      />
      {inset ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, corners, { boxShadow: inset }]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    alignItems: "center",
    justifyContent: "center",
  },
});
