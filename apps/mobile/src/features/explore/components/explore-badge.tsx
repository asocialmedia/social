import { Clapperboard, Sparkles } from "lucide-react-native";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { useAppTheme } from "@/theme";

export function ExploreBadge({
  kind,
  style,
}: {
  kind: "gust" | "recommended";
  style?: StyleProp<ViewStyle>;
}) {
  const { isDark } = useAppTheme();
  const recommended = kind === "recommended";
  let color = "#ffffff";
  let backgroundColor = "#262626";
  let borderColor = "#575757";
  if (recommended) {
    color = isDark ? "#fdba74" : "#9a3412";
    backgroundColor = isDark ? "#3a1a0c" : "#ffedd5";
    borderColor = isDark ? "#9a4d20" : "#d5a67b";
  }
  return (
    <View
      className="flex-row items-center gap-1 rounded-full border px-2 py-1"
      style={[
        {
          backgroundColor,
          borderColor,
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 1px 1px rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.2)",
        },
        style,
      ]}
    >
      {recommended ? (
        <Sparkles color={color} fill={color} size={11} />
      ) : (
        <Clapperboard color="#ff9500" size={11} />
      )}
      <Text
        numberOfLines={1}
        style={{ color, fontFamily: "SofiaProBold", fontSize: 10 }}
      >
        {recommended ? "Recommended" : "Gust"}
      </Text>
    </View>
  );
}
