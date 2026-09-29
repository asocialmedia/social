import { Stack } from "expo-router";
import { Platform } from "react-native";

export default function PostsLayout() {
  return (
    <Stack
      screenOptions={{
        animation: Platform.OS === "ios" ? "default" : "slide_from_right",
        headerShown: false,
      }}
    >
      <Stack.Screen
        name="[postId]/index"
        options={{
          animation: Platform.OS === "ios" ? "default" : "slide_from_right",
        }}
      />
      <Stack.Screen
        name="[postId]/media/[index]"
        options={{
          animation: "fade_from_bottom",
          animationDuration: 260,
          contentStyle: { backgroundColor: "#000000" },
          presentation: "fullScreenModal",
        }}
      />
    </Stack>
  );
}
