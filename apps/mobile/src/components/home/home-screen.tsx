// Root home page: mobile header + guest feed placeholder + guest auth bar.
// UI-only: no feed API yet, so guests get the same prompt card the web shows
// gated surfaces (AuthPromptCard copy) until the feed is ported.

import { useRouter } from "expo-router";
import { Compass } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SOCIAL_SHADOWS, useAppTheme } from "@/theme";

import { GuestAuthBar } from "./guest-auth-bar";
import { MobileHeader } from "./mobile-header";

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader user={null} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.promptCard,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              shadowColor: theme.cardShadow,
            },
          ]}
        >
          <View
            style={[
              styles.promptIcon,
              { backgroundColor: theme.inputBg, boxShadow: SOCIAL_SHADOWS },
            ]}
          >
            <Compass color="#ff9500" size={28} />
          </View>
          <Text style={[styles.promptTitle, { color: theme.inputLabel }]}>
            Get your account
          </Text>
          <Text
            style={[styles.promptDescription, { color: theme.dividerText }]}
          >
            Log in or sign up to see the feed, post, and join the conversation.
          </Text>
          <View style={styles.promptActions}>
            <Pressable
              onPress={() => router.push("/(auth)/login")}
              style={styles.promptAction}
            >
              {({ pressed }) => (
                <View style={[styles.loginCta, pressed && styles.pressedShift]}>
                  <Text style={styles.loginCtaText}>Log in</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => router.push("/(auth)/signup")}
              style={styles.promptAction}
            >
              {({ pressed }) => (
                <View
                  style={[
                    styles.signupCta,
                    {
                      backgroundColor: theme.socialBtnBg,
                      boxShadow: SOCIAL_SHADOWS,
                    },
                    pressed && styles.pressedShift,
                  ]}
                >
                  <Text
                    style={[
                      styles.signupCtaText,
                      { color: theme.socialBtnText },
                    ]}
                  >
                    Sign up
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
      <GuestAuthBar />
    </View>
  );
}

const styles = StyleSheet.create({
  loginCta: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
  },
  loginCtaText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  promptAction: {
    flex: 1,
  },
  promptActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    width: "100%",
  },
  promptCard: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    maxWidth: 384,
    padding: 20,
    width: "100%",
  },
  promptDescription: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
  },
  promptIcon: {
    alignItems: "center",
    borderRadius: 9999,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  promptTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
  },
  root: {
    flex: 1,
  },
  scrollContent: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: 16,
  },
  signupCta: {
    alignItems: "center",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
  },
  signupCtaText: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
});
