import { MESSAGES_CONNECTION_ERROR } from "@asm/ui/lib/messages-errors";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import errorImage from "@/assets/images/error.png";
import { useAppTheme } from "@/theme";

import { iconButton3d } from "../lib/message-recipes";
import { PressableRow } from "./messages-primitives";

export function MessagesErrorState({
  compact = false,
  message = MESSAGES_CONNECTION_ERROR,
  onRetry,
}: {
  compact?: boolean;
  message?: string;
  onRetry: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  const button = iconButton3d(isDark);
  return (
    <View style={[styles.root, !compact && styles.full]}>
      <Image
        contentFit="contain"
        source={errorImage}
        style={compact ? styles.smallArt : styles.art}
      />
      <Text
        accessibilityRole="alert"
        style={[styles.message, { color: theme.dividerText }]}
      >
        {message}
      </Text>
      <PressableRow
        onPress={onRetry}
        style={{
          ...styles.retry,
          backgroundColor: button.background,
          boxShadow: button.shadows,
        }}
      >
        <Text style={[styles.retryText, { color: theme.inputText }]}>
          Try again
        </Text>
      </PressableRow>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { height: 144, width: 144 },
  full: { flex: 1, justifyContent: "center", paddingBottom: 100 },
  message: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 340,
    textAlign: "center",
  },
  retry: {
    alignSelf: "center",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryText: { fontFamily: "SofiaProMed", fontSize: 14 },
  root: { alignItems: "center", gap: 16, padding: 24 },
  smallArt: { height: 48, width: 48 },
});
