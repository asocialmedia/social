import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import authImage from "@/assets/images/auth.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
} from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";
import {
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
} from "@/theme/shadows";

const GRAY_BUTTON_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 1.5px 2px rgba(255, 255, 255, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 5px rgba(0, 0, 0, 0.12), 0 8px 16px -4px rgba(0, 0, 0, 0.2)";
const GRAY_BUTTON_PRESSED_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 1px 2px rgba(255, 255, 255, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 2px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.12)";
const GRAY_BUTTON_SHADOWS_LIGHT =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.85), inset 0 1.5px 2px rgba(255, 255, 255, 0.95), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 1px rgba(255, 255, 255, 0.6), 0 1px 2px rgba(0, 0, 0, 0.06)";
const GRAY_BUTTON_PRESSED_SHADOWS_LIGHT =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.6), inset 0 1px 3px rgba(255, 255, 255, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)";

interface AuthPromptCardProps {
  description?: string;
  imageSize?: number;
  primaryLabel?: string;
  secondaryLabel?: string;
  showImage?: boolean;
  title: string;
}

export function AuthPromptCard({
  description,
  imageSize = 128,
  primaryLabel = "Log in",
  secondaryLabel = "Sign up",
  showImage = true,
  title,
}: AuthPromptCardProps) {
  const router = useRouter();
  const { isDark, theme } = useAppTheme();
  const loginShadows = isDark
    ? LOGIN_BUTTON_SHADOWS
    : LOGIN_BUTTON_SHADOWS_LIGHT;
  const loginPressedShadows = isDark
    ? LOGIN_BUTTON_PRESSED_SHADOWS
    : LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT;
  const cardShadows = isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS;
  const grayShadows = isDark ? GRAY_BUTTON_SHADOWS : GRAY_BUTTON_SHADOWS_LIGHT;
  const grayPressedShadows = isDark
    ? GRAY_BUTTON_PRESSED_SHADOWS
    : GRAY_BUTTON_PRESSED_SHADOWS_LIGHT;
  const grayColors = isDark
    ? (["#4a4a4a", "#333333"] as const)
    : (["#f7f8fa", "#e4e7ec"] as const);
  const grayPressedColors = isDark
    ? (["#333333", "#2a2a2a"] as const)
    : (["#dfe3e9", "#cdd2da"] as const);

  return (
    <Gradient3D
      colors={[theme.cardBg, theme.cardBg] as const}
      radius={16}
      shadows={cardShadows}
      style={[
        styles.card,
        {
          borderColor: theme.cardBorder,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      {showImage ? (
        <Image
          accessibilityLabel=""
          contentFit="contain"
          source={authImage}
          style={{ height: imageSize, width: imageSize }}
        />
      ) : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.inputText }]}>{title}</Text>
        {description ? (
          <Text style={[styles.description, { color: theme.dividerText }]}>
            {description}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push("/(auth)/login")}
          style={styles.action}
        >
          {({ pressed }) => (
            <Gradient3D
              colors={pressed ? ORANGE_PRESSED_GRADIENT : ORANGE_GRADIENT}
              radius={9999}
              shadows={pressed ? loginPressedShadows : loginShadows}
              style={[styles.actionSurface, pressed && styles.pressed]}
            >
              <Text style={styles.primaryLabel}>{primaryLabel}</Text>
            </Gradient3D>
          )}
        </Pressable>
        <Pressable
          onPress={() => router.push("/(auth)/signup")}
          style={styles.action}
        >
          {({ pressed }) => (
            <Gradient3D
              colors={pressed ? grayPressedColors : grayColors}
              radius={9999}
              shadows={pressed ? grayPressedShadows : grayShadows}
              style={[styles.actionSurface, pressed && styles.pressed]}
            >
              <Text
                style={[
                  styles.secondaryLabel,
                  {
                    color: isDark ? "#ffffff" : "#1f2430",
                    ...({
                      textShadow: isDark
                        ? "0 1px 1px rgba(0, 0, 0, 0.2)"
                        : "0 1px 0 rgba(255, 255, 255, 0.7)",
                    } as Record<string, string>),
                  },
                ]}
              >
                {secondaryLabel}
              </Text>
            </Gradient3D>
          )}
        </Pressable>
      </View>
    </Gradient3D>
  );
}

const styles = StyleSheet.create({
  action: {
    borderRadius: 9999,
    flex: 1,
    minHeight: 36,
  },
  actionSurface: {
    height: 36,
    overflow: "hidden",
    paddingHorizontal: 16,
    width: "100%",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  card: {
    gap: 12,
    maxWidth: 340,
    padding: 20,
    width: "100%",
  },
  copy: {
    gap: 4,
    width: "100%",
  },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 20,
    textAlign: "center",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  primaryLabel: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    letterSpacing: -0.3,
    ...({ textShadow: "0 1px 1px rgba(0, 0, 0, 0.2)" } as Record<
      string,
      string
    >),
  },
  secondaryLabel: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    letterSpacing: -0.3,
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
    lineHeight: 24,
    textAlign: "center",
  },
});
