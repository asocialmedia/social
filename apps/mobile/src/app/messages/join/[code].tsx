// The screen at the end of a den invite link, on a phone that has no dens.
//
// A den is a web feature. The app does not have Messages yet, so this route
// exists to do one thing honestly: recognise the link, say where the feature
// actually is, and hand the reader the real join screen with their code intact.
//
// What it deliberately does NOT do is pretend. There is no half-built member
// list, no "join" button that cannot join, and no silent redirect that loses the
// code. The copy names the gap rather than describing a product that does not
// exist here, because a link is the one place a user is most likely to believe
// the app can do the thing it just sent them.
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { StatusScreen } from "@/components/feedback/status-screen";
import { denJoinHandoff } from "@/features/notifications/lib/den-link";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

export default function DenJoinHandoffScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  // The route param, so an invite link that arrives as
  // `asocialmedia://messages/join/<code>` is claimed by this file rather than by
  // `+not-found`. The code is carried across verbatim; nothing normalizes it
  // here, because the web join screen is the one place that decides what a code
  // means.
  const { code } = useLocalSearchParams<{ code?: string }>();
  const normalizedCode = Array.isArray(code) ? (code[0] ?? "") : (code ?? "");
  const handoff = useMemo(
    () => denJoinHandoff(normalizedCode, getApiBaseUrl()),
    [normalizedCode]
  );

  const openOnWeb = async () => {
    if (!handoff.webUrl) {
      return;
    }
    try {
      await Linking.openURL(handoff.webUrl);
    } catch (error) {
      // No browser, or a device that refuses the intent. The screen is still on
      // screen with the explanation, which is the entire reason it exists, so
      // this is a log and not a crash.
      logWarn("den.handoff_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const goHome = () => {
    router.replace("/");
  };

  return (
    <StatusScreen
      action={
        handoff.webUrl ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void openOnWeb();
              }}
              style={({ pressed }) => [
                styles.action,
                { opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={styles.actionText}>Open in browser</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={goHome}
              style={({ pressed }) => [
                styles.secondary,
                { opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={[styles.secondaryText, { color: theme.auxLink }]}>
                Back to the feed
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={goHome}
            style={({ pressed }) => [
              styles.action,
              { opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <Text style={styles.actionText}>Back to the feed</Text>
          </Pressable>
        )
      }
      description={handoff.body}
      title={handoff.title}
    />
  );
}

const styles = StyleSheet.create({
  action: {
    backgroundColor: "#f97316",
    borderCurve: "continuous",
    borderRadius: 9999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  actionText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 15 },
  actions: { alignItems: "center", gap: 12 },
  secondary: { paddingHorizontal: 16, paddingVertical: 8 },
  secondaryText: { fontFamily: "SofiaProReg", fontSize: 14 },
});
