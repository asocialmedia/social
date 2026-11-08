import type { ActivityIndicatorProps } from "react-native";
import { View } from "react-native";

import { Spinner3D } from "./spinner-3d";

const SIZES = { large: 56, small: 24 };
// Retain the existing call-site contract while all loading uses Spinner3D.
export type ZephLoaderVariant =
  | "general"
  | "media"
  | "messages"
  | "search"
  | "security";

export function ZephLoader({
  animating = true,
  color,
  hidesWhenStopped = true,
  size = "small",
  style,
  variant: _variant,
  ...props
}: ActivityIndicatorProps & { variant?: ZephLoaderVariant }) {
  if (!animating && hidesWhenStopped) {
    return null;
  }
  const dimension = typeof size === "number" ? size : SIZES[size];
  return (
    <View
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[
        {
          alignItems: "center",
          height: dimension,
          justifyContent: "center",
          width: dimension,
        },
        style,
      ]}
      {...props}
    >
      <Spinner3D
        accessible={false}
        animating={animating}
        color={color}
        size={dimension}
      />
    </View>
  );
}
