// The action button every StatusScreen wears: the "Try Again" on the error
// boundary, the "Return Home" on the not-found route.
//
// ONE component, because the two screens used to drift: the error page had the
// web `.btn-3d` treatment and the not-found page had a flat orange fill, so a
// dead link and a crash looked like two different products.
//
// Web's `.btn-3d` is a dual border by construction: a light inset lip over a
// dark outer ring, on an orange gradient. React Native's boxShadow has no inset,
// so Gradient3D paints the inset layers on an overlay above the gradient, and
// the ring is a second view behind it, one pixel proud on every side. That is
// the same pair of edges, not a flat fill.

import { Pressable, StyleSheet, Text } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
} from "@/components/surface/recipes";

export function StatusActionButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.ring}
    >
      {({ pressed }) => (
        <Gradient3D
          colors={pressed ? ORANGE_PRESSED_GRADIENT : ORANGE_GRADIENT}
          radius={9999}
          shadows={ORANGE_BUTTON_SHADOWS}
          style={styles.action}
        >
          <Text style={styles.label}>{label}</Text>
        </Gradient3D>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    // The light lip, which is the inset half of the dual border.
    borderColor: "rgba(255, 255, 255, 0.3)",
    borderCurve: "continuous",
    borderRadius: 9999,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  label: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 15,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  // The dark outer ring, one pixel proud of the gradient on every side. This
  // plus the gradient's light lip is the pair web's .btn-3d draws with an inset
  // shadow and an outer ring in a single box-shadow, which React Native cannot
  // express because its boxShadow has no inset.
  ring: {
    borderColor: "rgba(170, 60, 0, 0.95)",
    borderCurve: "continuous",
    borderRadius: 9999,
    borderWidth: 1,
    padding: 1,
  },
});
