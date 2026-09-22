// Verification gate for the install credential. Rendered when a mutating
// request needs a token and none is stored yet, so the user solves a Turnstile
// challenge without an API round-trip ever revealing why.

import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Spinner3D } from "@/components/feedback/spinner-3d";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { resolveTurnstileBaseUrl } from "../lib/turnstile-page";
import { useInstall } from "../state/install";
import { TurnstileWebView } from "./turnstile-webview";

interface InstallVerificationGateProps {
  sitekey: string | undefined;
}

// Cloudflare accepts localhost for any sitekey, and the dev server's
// TURNSTILE_HOSTNAMES allowlist does too, so it is the one origin that works
// for both while the dev API sits on an emulator/LAN alias.
// See resolveTurnstileBaseUrl for why the origin matters at all.
const TURNSTILE_BASE_URL = resolveTurnstileBaseUrl(
  process.env.EXPO_PUBLIC_TURNSTILE_BASE_URL,
  getApiBaseUrl()
);

export function InstallVerificationGate({
  sitekey,
}: InstallVerificationGateProps) {
  const { isGateVisible, dismissGate, status, submitVerification } =
    useInstall();
  const { theme } = useAppTheme();
  const [resetSignal, setResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Only a solved-then-expired challenge is worth retrying automatically.
  // A load/connection error must NOT reset, or the widget re-renders, errors,
  // resets again and flickers forever (which is exactly what it used to do).
  const handleExpire = () => {
    setError("The check expired. Try again.");
  };

  const retry = () => {
    setError(null);
    setResetSignal((value) => value + 1);
  };

  // Dismissal is unavailable while a verification request is in flight:
  // dismissing then would report cancellation while the request could still
  // persist a credential afterwards (the provider also ignores such a stale
  // result, so Android-back dismissal stays consistent too).
  const isVerifying = status === "verifying";

  const handleVerify = async (token: string) => {
    setError(null);
    const ok = await submitVerification(token);
    if (!ok) {
      // Server refused. Leave the widget alone and offer an explicit retry.
      setError("That check didn't go through. Try again.");
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => {
        // Android back must not dismiss mid-verification, matching the
        // disabled "Not now" button above.
        if (!isVerifying) {
          dismissGate();
        }
      }}
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
              baseUrl={TURNSTILE_BASE_URL}
              onError={() => {
                setError(
                  "The check could not load. Check your connection, then tap Retry."
                );
              }}
              onExpire={handleExpire}
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
            <View style={styles.verifying}>
              <Spinner3D size={32} />
              <Text style={[styles.body, { color: theme.dividerText }]}>
                Verifying…
              </Text>
            </View>
          ) : null}
          {error ? (
            <Text style={[styles.body, { color: theme.errorBannerText }]}>
              {error}
            </Text>
          ) : null}

          <View style={styles.footer}>
            {error ? (
              <Pressable hitSlop={6} onPress={retry}>
                <Text style={[styles.action, { color: theme.auxLink }]}>
                  Retry
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={isVerifying}
              hitSlop={6}
              onPress={dismissGate}
              style={isVerifying ? styles.disabled : undefined}
            >
              <Text style={[styles.action, { color: theme.auxLink }]}>
                Not now
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
    fontWeight: "normal",
  },
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
  disabled: {
    opacity: 0.4,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 20,
    justifyContent: "center",
    paddingVertical: 4,
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
  verifying: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
  },
});
