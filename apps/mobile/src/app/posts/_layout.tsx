import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { postEnterAnimation } from "@/lib/interaction/navigation-motion";
import { useStartupPresented } from "@/lib/lifecycle/startup-context";

export default function PostsLayout() {
  const presented = useStartupPresented();
  const reducedMotion = useReducedMotion();
  const animation = postEnterAnimation(presented, Platform.OS, reducedMotion);
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
          animation,
          animationDuration: 200,
          contentStyle: { backgroundColor: "#000000" },
          presentation: "card",
        }}
      />
    </Stack>
  );
}
