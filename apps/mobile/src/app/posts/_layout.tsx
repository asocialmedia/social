import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { finishPostEnter, postEnterAnimation } from "@/lib/navigation-motion";
import { useStartupPresented } from "@/lib/startup-context";

export default function PostsLayout() {
  const presented = useStartupPresented();
  const reducedMotion = useReducedMotion();
  const animation = postEnterAnimation(presented);
  return (
    <Stack
      screenOptions={{
        animation,
        headerShown: false,
      }}
      screenListeners={({ navigation }) => ({
        transitionEnd: (event) => {
          finishPostEnter(
            navigation.setOptions,
            event.data.closing,
            Platform.OS,
            reducedMotion
          );
        },
      })}
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
