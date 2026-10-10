// The messages stack: the conversation list, then one screen per thread.
//
// WITHOUT THIS FILE THE ROUTE DOES NOT EXIST. A directory with no layout is
// inlined into its parent navigator, so the screens registered as literal
// routes on the ROOT stack. And the list file must be named `index.tsx`:
// `_index.tsx` is not special (only `_layout` is), so it registered as the
// literal route `/messages/_index` and `/messages` was not a real href.
// Two things broke: the root layout's `<Stack.Screen name="messages" />`
// matched no child and warned, and the dock's Messages tab and the profile
// Message button both landed on +not-found. This layout plus the `index`
// name is what promotes `messages` to a route of its own.
//
// The identity provider lives HERE rather than on each screen. It bootstraps a
// key on a native background queue. One provider over the subtree shares that
// recovery between the list and a thread, and a deep
// link straight into a thread still resolves its key first, because the layout
// renders above the thread. See the recovery invariants in message-identity.tsx.

import { Stack } from "expo-router";
import { Platform } from "react-native";

import { MessagesIdentityProvider } from "@/features/messages/state/message-identity";
import { useAppTheme } from "@/theme";

export default function MessagesLayout() {
  const { theme } = useAppTheme();

  return (
    <MessagesIdentityProvider>
      <Stack
        screenOptions={{
          animation: Platform.OS === "ios" ? "default" : "slide_from_right",
          animationDuration: 200,
          contentStyle: { backgroundColor: theme.containerBg },
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="[conversationId]/index" />
      </Stack>
    </MessagesIdentityProvider>
  );
}
