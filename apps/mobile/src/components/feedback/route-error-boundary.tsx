// Per-route error boundary, exported as `ErrorBoundary` from the heavy routes
// (post detail and media, gusts, a DM thread, community chat, settings).
// Expo Router mounts it in place of only that route when the route throws
// during render, so one broken screen no longer replaces the whole app with
// the root boundary's screen, and the reader keeps the dock to leave it.
import type { ErrorBoundaryProps } from "expo-router";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import errorImage from "@/assets/images/error.png";
import { logError } from "@/lib/lifecycle/telemetry";

import { StatusActionButton } from "./status-action-button";
import { StatusScreen } from "./status-screen";

export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();
  useEffect(() => {
    // Logged, never shown: a thrown message is written for a developer.
    logError("ui.route_error_boundary", error);
  }, [error]);
  return (
    <StatusScreen
      action={
        <View style={styles.actions}>
          <StatusActionButton
            label="Try Again"
            onPress={() => {
              void retry();
            }}
          />
          <StatusActionButton
            label="Go Home"
            onPress={() => {
              if (router.canDismiss()) {
                router.dismissAll();
              }
              router.replace("/");
            }}
          />
        </View>
      }
      description="This screen hit an unexpected error. Try again, and let us know if it keeps happening."
      image={errorImage}
      title="Something went wrong"
    />
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    gap: 12,
  },
});
