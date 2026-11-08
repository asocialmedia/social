// Native port of web's FeedErrorState (components/feeds/feed-error-state).
// The full variant fills the feed (size-36 art, min-h-72, p-6, gap-4); the
// compact one sits above loaded posts when a single source fails (size-16
// art, p-4, gap-3). Both carry the role="alert" message (text-sm, max-w-xs)
// and web's premium rounded-full retry, which reads "Trying again…" and
// stays disabled while the retry is in flight.
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import errorImage from "@/assets/images/error.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
} from "@/components/surface/recipes";
import { haptic } from "@/lib/interaction/haptics";
import { useAppTheme } from "@/theme";

export function FeedErrorState({
  compact = false,
  isRetrying = false,
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  compact?: boolean;
  isRetrying?: boolean;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  const { theme } = useAppTheme();
  const label = isRetrying ? "Trying again…" : retryLabel;
  return (
    <View style={compact ? styles.compact : styles.full}>
      <Image
        contentFit="contain"
        source={errorImage}
        style={compact ? styles.artCompact : styles.art}
      />
      <Text
        accessibilityRole="alert"
        selectable
        style={[styles.message, { color: theme.dividerText }]}
      >
        {message}
      </Text>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ busy: isRetrying, disabled: isRetrying }}
        disabled={isRetrying}
        onPress={() => {
          haptic();
          onRetry();
        }}
        style={isRetrying ? styles.disabled : null}
      >
        {({ pressed }) => (
          <Gradient3D
            colors={pressed ? ORANGE_PRESSED_GRADIENT : ORANGE_GRADIENT}
            radius={9999}
            shadows={ORANGE_BUTTON_SHADOWS}
            style={[styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>{label}</Text>
          </Gradient3D>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { height: 144, width: 144 },
  artCompact: { height: 64, width: 64 },
  button: { height: 36, paddingHorizontal: 16 },
  buttonText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 14 },
  compact: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    padding: 16,
    width: "100%",
  },
  disabled: { opacity: 0.5 },
  full: {
    alignItems: "center",
    flex: 1,
    gap: 16,
    justifyContent: "center",
    minHeight: 288,
    padding: 24,
    width: "100%",
  },
  message: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 320,
    textAlign: "center",
  },
  pressed: { transform: [{ translateY: 1 }] },
});
