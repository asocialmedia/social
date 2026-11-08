// Native port of web (auth)/login/error/page.tsx. A failed provider callback
// lands here (or deep-links here) with `?error=<code>` and an optional
// `?email=`; the screen renders the page's copy and the same two actions
// (back to login, create an account) inside the shared auth shell.
import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertCircle } from "lucide-react-native";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import loginBgImage from "@/assets/images/login-image.jpg";
import { describeLoginError } from "@/features/auth/lib/auth-errors";
import { useAppTheme } from "@/theme";

import { AuthPrimaryButton } from "./auth-primary-button";
import { AuthShell } from "./auth-shell";

const SUPPORT_EMAIL = "dev.hashcodes@gmail.com";

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default function LoginErrorScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const params = useLocalSearchParams<{ email?: string; error?: string }>();
  const errorCode = firstParam(params.error);
  const email = firstParam(params.email);
  const message = describeLoginError(errorCode ?? undefined);

  return (
    <AuthShell
      backgroundImage={loginBgImage}
      heading="Authentication Error"
      onGuestPress={() => router.replace("/")}
    >
      <View style={styles.body}>
        <View
          style={[styles.iconBadge, { backgroundColor: theme.errorBannerBg }]}
        >
          <AlertCircle color="#ff7b63" size={44} />
        </View>
        <Text
          style={[
            styles.message,
            { color: theme.dividerText, fontFamily: "SofiaProReg" },
          ]}
        >
          {message}
        </Text>
        {email ? (
          <Text
            style={[
              styles.email,
              { color: theme.dividerText, fontFamily: "SofiaProReg" },
            ]}
          >
            for email:{" "}
            <Text style={{ fontFamily: "SofiaProMed" }}>{email}</Text>
          </Text>
        ) : null}
        <View style={styles.actions}>
          <AuthPrimaryButton
            label="Login with Email"
            onPress={() => router.replace("/(auth)/login")}
          />
          <Pressable
            accessibilityLabel="Create a new account"
            accessibilityRole="button"
            hitSlop={4}
            onPress={() => router.replace("/(auth)/signup")}
            style={[styles.outlineButton, { borderColor: theme.cardBorder }]}
          >
            <Text
              style={[
                styles.outlineLabel,
                { color: theme.inputText, fontFamily: "SofiaProMed" },
              ]}
            >
              Create New Account
            </Text>
          </Pressable>
        </View>
        <View style={styles.supportRow}>
          <Text
            style={[
              styles.supportText,
              { color: theme.dividerText, fontFamily: "SofiaProReg" },
            ]}
          >
            Need help?{" "}
          </Text>
          <Pressable
            accessibilityLabel="Contact support by email"
            accessibilityRole="link"
            hitSlop={4}
            onPress={() => {
              void Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
            }}
          >
            <Text
              style={[
                styles.supportText,
                { color: theme.auxLink, fontFamily: "SofiaProMed" },
              ]}
            >
              Contact Support
            </Text>
          </Pressable>
        </View>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 8,
    marginTop: 8,
    width: "100%",
  },
  body: {
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  email: {
    fontSize: 13,
    textAlign: "center",
  },
  iconBadge: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
    padding: 16,
  },
  message: {
    fontSize: 14,
    textAlign: "center",
  },
  outlineButton: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: "100%",
  },
  outlineLabel: {
    fontSize: 16,
  },
  supportRow: {
    flexDirection: "row",
    marginTop: 4,
  },
  supportText: {
    fontSize: 13,
  },
});
