import { ArrowLeft } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "@/theme";

export function PostDetailHeader({
  onBack,
  title = "Post",
  subtitle,
}: {
  onBack: () => void;
  title?: string;
  subtitle?: string;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row items-center gap-2 px-3 pb-2"
      style={{ paddingTop: insets.top }}
    >
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => ({
          alignItems: "center",
          borderRadius: 9999,
          height: 36,
          justifyContent: "center",
          width: 36,
          ...(pressed ? { opacity: 0.7, transform: [{ scale: 0.94 }] } : {}),
        })}
      >
        <ArrowLeft color={theme.inputText} size={20} />
      </Pressable>
      <Text
        style={{
          color: theme.inputText,
          fontFamily: "SofiaProBold",
          fontSize: 18,
          fontWeight: "normal",
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          numberOfLines={1}
          style={{ color: theme.dividerText, flexShrink: 1 }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
