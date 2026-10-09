import { Stack } from "expo-router";
import { Platform } from "react-native";

import { useStartupPresented } from "@/lib/startup-context";

export default function PostsLayout() {
  const presented = useStartupPresented();
  const navigationAnimation =
    Platform.OS === "ios" ? "default" : "slide_from_right";
  const animation = presented ? navigationAnimation : "none";
  return (
    <Stack
      screenOptions={{
        animation,
        headerShown: false,
      }}
    >
      <Stack.Screen
        name="[postId]/index"
        options={{
          animation,
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
