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

export function Gradient3D({
  children,
  colors,
  radius = 9999,
  shadows,
  style,
}: {
  children?: ReactNode;
  colors: readonly [string, string, ...string[]];
  radius?: number;
  // A full CSS box-shadow list, inset and outer layers mixed, as on web.
  shadows: string;
  // Size and content layout; the surface itself owns radius and shadows.
  style?: StyleProp<ViewStyle>;
}) {
  const { inset, outer } = splitBoxShadow(shadows);
  return (
    <View
      style={[
        styles.surface,
        style,
        { borderRadius: radius },
        outer ? { boxShadow: outer } : null,
      ]}
    >
      <LinearGradient
        colors={colors}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
      {inset ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, boxShadow: inset },
          ]}
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
