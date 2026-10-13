import { LinearGradient } from "expo-linear-gradient";
import { Pressable, Text, View } from "react-native";

import { ORANGE_GRADIENT } from "@/components/surface/recipes";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

export function SettingsChoice({
  checked,
  disabled,
  label,
  description,
  onPress,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onPress: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.cardBg,
        borderColor: checked ? "#e65500" : theme.cardBorder,
        borderRadius: 14,
        borderWidth: 1,
        boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
        flexDirection: "row",
        gap: 12,
        opacity: pressed || disabled ? 0.65 : 1,
        padding: 14,
      })}
    >
      <View
        style={{
          backgroundColor: theme.containerBg,
          borderColor: checked ? "#c75600" : theme.cardBorder,
          borderRadius: 11,
          borderWidth: 1,
          boxShadow: checked
            ? "inset 0 1px 2px rgba(255,255,255,0.65), 0 1px 2px rgba(0,0,0,0.15)"
            : "inset 0 1px 3px rgba(0,0,0,0.15), inset 0 0 0 1px rgba(255,255,255,0.15)",
          height: 22,
          marginTop: 1,
          overflow: "hidden",
          width: 22,
        }}
      >
        {checked ? (
          <LinearGradient
            colors={ORANGE_GRADIENT}
            style={{ alignItems: "center", flex: 1, justifyContent: "center" }}
          >
            <View
              style={{
                backgroundColor: "#fff",
                borderRadius: 4,
                boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                height: 8,
                width: 8,
              }}
            />
          </LinearGradient>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={{
            color: theme.inputText,
            fontFamily: "SofiaProMed",
            fontSize: 14,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            color: theme.dividerText,
            fontFamily: "SofiaProReg",
            fontSize: 13,
            lineHeight: 18,
          }}
        >
          {description}
        </Text>
      </View>
    </Pressable>
  );
}
