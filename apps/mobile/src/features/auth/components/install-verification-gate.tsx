// Verification gate for the install credential. Rendered when a mutating
// request needs a token and none is stored yet, so the user solves a Turnstile
// challenge without an API round-trip ever revealing why.

import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

import { useInstall } from "../state/install";
import { TurnstileWebView } from "./turnstile-webview";

interface InstallVerificationGateProps {
  sitekey: string | undefined;
}

export function InstallVerificationGate({
  sitekey,
}: InstallVerificationGateProps) {
  const { isGateVisible, dismissGate, status, submitVerification } =
    useInstall();
  const { theme } = useAppTheme();
  const [resetSignal, setResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async (token: string) => {
    setError(null);
    const ok = await submitVerification(token);
    if (!ok) {
      setError("That check didn't go through. Try again.");
      setResetSignal((value) => value + 1);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={dismissGate}
      transparent
      visible={isGateVisible}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
            },
          ]}
        >
          <Text style={[styles.title, { color: "#ff9500" }]}>
            Quick security check
          </Text>
          <Text style={[styles.body, { color: theme.dividerText }]}>
            Confirm you&apos;re human to continue. This only happens once per
            install.
          </Text>

          {sitekey ? (
            <TurnstileWebView
              action="mobile-register"
              onError={(code) => {
                setError(`The check could not load (${code}).`);
                setResetSignal((value) => value + 1);
              }}
              onExpire={() => {
                setResetSignal((value) => value + 1);
              }}
              onVerify={(token) => {
                void handleVerify(token);
              }}
              resetSignal={resetSignal}
              sitekey={sitekey}
            />
          ) : (
            <Text style={[styles.body, { color: theme.errorBannerText }]}>
              This build has no Turnstile site key, so sign-in cannot be
              completed here.
            </Text>
          )}

          {status === "verifying" ? (
            <Text style={[styles.body, { color: theme.dividerText }]}>
              Verifying…
            </Text>
          ) : null}
          {error ? (
            <Text style={[styles.body, { color: theme.errorBannerText }]}>
              {error}
            </Text>
          ) : null}

          <Pressable hitSlop={6} onPress={dismissGate} style={styles.dismiss}>
            <Text style={[styles.dismissText, { color: theme.auxLink }]}>
              Not now
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
    textAlign: "center",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    maxWidth: 340,
    padding: 20,
    width: "100%",
  },
  dismiss: {
    alignItems: "center",
    paddingVertical: 4,
  },
  dismissText: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
    fontWeight: "normal",
  },
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 18,
    fontWeight: "normal",
    textAlign: "center",
  },
});
