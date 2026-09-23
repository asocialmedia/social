import { Stack } from "expo-router";

export default function PostsLayout() {
  return (
    <Stack
      screenOptions={{
        animation: "fade",
        animationDuration: 200,
        headerShown: false,
      }}
    />
  );
}
