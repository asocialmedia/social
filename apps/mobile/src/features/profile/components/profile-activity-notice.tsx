import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import errorImage from "@/assets/images/error.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_GRADIENT,
  orangeSurfaceShadows,
  themeText,
} from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

// Web's compact FeedErrorState: a small error illustration, the message, and
// a premium (btn-3d) retry pill. Used in the profile list footer when one of
// the merged sources fails after rows are already on screen.
export function ProfileFeedErrorNotice({
  isRetrying = false,
  message,
  onRetry,
}: {
  isRetrying?: boolean;
  message: string;
  onRetry: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View style={styles.compact}>
      <Image contentFit="contain" source={errorImage} style={styles.image} />
      <Text
        accessibilityRole="alert"
        style={[styles.message, { color: theme.dividerText }]}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={isRetrying}
        onPress={onRetry}
      >
        <Gradient3D
          colors={ORANGE_GRADIENT}
          shadows={orangeSurfaceShadows(isDark)}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            {isRetrying ? "Trying again…" : "Try again"}
          </Text>
        </Gradient3D>
      </Pressable>
    </View>
  );
}

// Web's inline Bluesky failure line: destructive text with a bare
// "Try again" button after it.
export function ProfileExternalErrorLine({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { isDark } = useAppTheme();
  const { destructive } = themeText(isDark);
  return (
    <Text style={[styles.line, { color: destructive }]}>
      {message}{" "}
      <Text
        accessibilityRole="button"
        onPress={onRetry}
        style={styles.lineAction}
      >
        Try again
      </Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 16,
  },
  buttonText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 14 },
  compact: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    padding: 16,
    width: "100%",
  },
  image: { height: 64, width: 64 },
  line: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    padding: 16,
    textAlign: "center",
  },
  lineAction: { fontFamily: "SofiaProMed" },
  message: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    maxWidth: 320,
    textAlign: "center",
  },
});
