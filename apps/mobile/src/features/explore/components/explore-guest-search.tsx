import { Search } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { premiumInput } from "@/components/surface/recipes";
import { useSearchStore } from "@/features/search/state/search-store";
import { useAppTheme } from "@/theme";

export function ExploreGuestSearch() {
  const { isDark } = useAppTheme();
  const field = premiumInput(isDark, false);
  return (
    <View className="px-[16px] pt-[12px] pb-[4px]">
      <Pressable
        accessibilityLabel="Search people, posts, and communities"
        accessibilityRole="button"
        onPress={() => useSearchStore.getState().open()}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: field.background,
            boxShadow: premiumInput(isDark, pressed).shadows,
          },
        ]}
        testID="explore-guest-search"
      >
        <Search color={field.placeholder} size={18} />
        <Text
          numberOfLines={1}
          style={{
            color: field.placeholder,
            flex: 1,
            fontFamily: "SofiaProReg",
            fontSize: 14,
          }}
        >
          Search people, posts, and communities
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
  },
});
