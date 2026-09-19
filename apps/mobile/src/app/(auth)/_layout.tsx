// Expo Router v57 auth group layout. Route group (auth) keeps URLs clean
// (/login, /signup, ...) while sharing the stack + signup state.
// Docs: https://docs.expo.dev/versions/v57.0.0/sdk/router/stack/

import { Stack } from "expo-router";

import { SignupStateProvider } from "@/state/signup-state";
import { useAppTheme } from "@/theme";

export default function AuthGroupLayout() {
  const { theme } = useAppTheme();

  return (
    <SignupStateProvider>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.containerBg },
          headerShown: false,
        }}
      >
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="confirm-reset" />
        <Stack.Screen name="help" />
      </Stack>
    </SignupStateProvider>
  );
}
