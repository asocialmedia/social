// Native port of web (auth)/verify-email/page.tsx. The emailed link opens
// this screen with `token`, `error` or `verified`; a token is checked once
// through /api/verify-email and the user is sent home when a session exists,
// or to sign in otherwise, matching the web redirect timing.
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CircleCheck, Mail, ShieldCheck, XCircle } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ZephLoader } from "@/components/feedback/zeph-loader";
import { verifyEmailToken } from "@/features/auth/lib/auth-api";
import { resolveVerifyEmailState } from "@/features/auth/lib/email-verification";
import { useSessionContext } from "@/features/auth/state/session";
import { BRAND_COLORS, useAppTheme } from "@/theme";

import { AuthPrimaryButton } from "./auth-primary-button";

const SUCCESS_SETTLE_MS = 500;
const REDIRECT_DELAY_MS = 1000;
const PRIMARY = BRAND_COLORS.primary;
const DESTRUCTIVE = "#ef4444";

type VerifyStatus = "error" | "loading" | "success";

function useLoop(durationMs: number, delayMs = 0): Animated.Value {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(value, {
          duration: durationMs,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          duration: 0,
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delayMs, durationMs, value]);
  return value;
}

function PulseDot({ delayMs }: { delayMs: number }) {
  const progress = useLoop(1000, delayMs);
  return (
    <Animated.View
      style={[
        styles.dot,
        {
          opacity: progress.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0.5, 1, 0.5],
          }),
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [1, 1.5, 1],
              }),
            },
          ],
        },
      ]}
    />
  );
}

function VerificationAnimation({ mutedColor }: { mutedColor: string }) {
  const scan = useLoop(2000);
  const bridge = useLoop(1500);
  const breathe = useLoop(2000);
  const { theme } = useAppTheme();
  return (
    <View style={styles.animationColumn}>
      <View style={styles.stage}>
        <View style={[styles.stageTile, styles.stageTileLeft]}>
          <Mail color={`${PRIMARY}99`} size={44} strokeWidth={2} />
        </View>
        <Animated.View
          style={[
            styles.bridge,
            {
              transform: [
                {
                  scaleX: bridge.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={[`${PRIMARY}00`, PRIMARY, `${PRIMARY}00`]}
            end={{ x: 1, y: 0 }}
            start={{ x: 0, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <View style={[styles.stageTile, styles.stageTileRight]}>
          <ShieldCheck color={`${PRIMARY}99`} size={44} strokeWidth={2} />
        </View>
        <Animated.View
          style={[
            styles.scanLine,
            {
              transform: [
                {
                  translateX: scan.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 256],
                  }),
                },
              ],
            },
          ]}
        />
      </View>
      <View style={styles.centered}>
        <Animated.Text
          style={[
            styles.loadingTitle,
            {
              color: theme.inputText,
              opacity: breathe.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [1, 0.5, 1],
              }),
            },
          ]}
        >
          Verifying your email...
        </Animated.Text>
        <Text style={[styles.body, { color: mutedColor, marginTop: 8 }]}>
          Please wait while we confirm your identity
        </Text>
      </View>
      <View style={styles.dotRow}>
        {[0, 1, 2].map((index) => (
          <PulseDot delayMs={index * 200} key={`dot-${index}`} />
        ))}
      </View>
    </View>
  );
}

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { isDark, theme } = useAppTheme();
  const { refresh } = useSessionContext();
  const params = useLocalSearchParams<{
    error?: string;
    token?: string;
    verified?: string;
  }>();
  const initial = useMemo(
    () =>
      resolveVerifyEmailState({
        error: params.error,
        token: params.token,
        verified: params.verified,
      }),
    [params.error, params.token, params.verified]
  );
  const [status, setStatus] = useState<VerifyStatus>(
    initial.kind === "error" ? "error" : "loading"
  );
  const attempted = useRef(false);
  const mutedColor = theme.dividerText;

  useEffect(() => {
    if (initial.kind === "verified") {
      router.replace("/");
      return;
    }
    if (initial.kind !== "verify" || attempted.current) {
      return;
    }
    attempted.current = true;
    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void (async () => {
      const ok = await verifyEmailToken(initial.token);
      if (!active) {
        return;
      }
      if (!ok) {
        setStatus("error");
        return;
      }
      setStatus("success");
      timers.push(
        setTimeout(() => {
          void (async () => {
            const session = await refresh().catch(() => null);
            if (!active) {
              return;
            }
            const signedIn = session?.status === "valid";
            timers.push(
              setTimeout(() => {
                router.replace(signedIn ? "/" : "/(auth)/login");
              }, REDIRECT_DELAY_MS)
            );
          })();
        }, SUCCESS_SETTLE_MS)
      );
    })();
    return () => {
      active = false;
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [initial, refresh, router]);

  const errorMessage =
    initial.kind === "error" ? initial.message : "Email verification failed.";

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.blob, styles.blobBlue]} />
        <View style={[styles.blob, styles.blobPurple]} />
        <View style={[styles.blob, styles.blobPink]} />
      </View>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: isDark
                ? "rgba(23, 23, 23, 0.6)"
                : "rgba(255, 255, 255, 0.6)",
              borderColor: theme.cardBorder,
              shadowColor: theme.cardShadow,
            },
          ]}
        >
          {status === "loading" ? (
            <VerificationAnimation mutedColor={mutedColor} />
          ) : null}
          {status === "success" ? (
            <View style={styles.resultColumn}>
              <View style={styles.successBadge}>
                <CircleCheck color={PRIMARY} size={64} strokeWidth={2} />
              </View>
              <Text style={[styles.resultTitle, { color: theme.inputText }]}>
                Email Verified! 🎉
              </Text>
              <Text style={[styles.body, styles.center, { color: mutedColor }]}>
                Your email has been successfully verified. Redirecting you
                now...
              </Text>
              <ZephLoader size="small" variant="security" />
            </View>
          ) : null}
          {status === "error" ? (
            <View style={styles.resultColumn}>
              <XCircle color={DESTRUCTIVE} size={64} />
              <Text style={[styles.resultTitle, { color: theme.inputText }]}>
                Verification Failed
              </Text>
              <Text style={[styles.body, styles.center, { color: mutedColor }]}>
                {errorMessage}
              </Text>
              <View style={styles.fullWidth}>
                <AuthPrimaryButton
                  label="Back to Login"
                  onPress={() => router.replace("/(auth)/login")}
                />
              </View>
            </View>
          ) : null}
        </View>
        <Text style={styles.wordmark}>ZEPHYR.</Text>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  animationColumn: { alignItems: "center", gap: 24 },
  blob: { borderRadius: 999, position: "absolute" },
  blobBlue: {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    height: 360,
    left: -60,
    top: -40,
    width: 360,
  },
  blobPink: {
    backgroundColor: "rgba(236, 72, 153, 0.08)",
    bottom: -60,
    height: 260,
    left: "20%",
    width: 260,
  },
  blobPurple: {
    backgroundColor: "rgba(168, 85, 247, 0.08)",
    height: 300,
    right: -80,
    top: "45%",
    width: 300,
  },
  body: { fontFamily: "SofiaProReg", fontSize: 14, lineHeight: 20 },
  bridge: {
    height: 4,
    left: 96,
    overflow: "hidden",
    position: "absolute",
    top: 32,
    width: 64,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    elevation: 6,
    maxWidth: 448,
    padding: 32,
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 15,
    width: "100%",
  },
  center: { textAlign: "center" },
  centered: { alignItems: "center" },
  dot: {
    backgroundColor: PRIMARY,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  dotRow: { flexDirection: "row", gap: 8 },
  fullWidth: { alignSelf: "stretch", marginTop: 16 },
  loadingTitle: { fontFamily: "SofiaProMed", fontSize: 18, lineHeight: 28 },
  resultColumn: { alignItems: "center", gap: 16 },
  resultTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 24,
    lineHeight: 32,
    textAlign: "center",
  },
  root: { flex: 1 },
  safeArea: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  scanLine: {
    backgroundColor: `${PRIMARY}80`,
    height: "100%",
    left: 0,
    position: "absolute",
    top: 0,
    width: 4,
  },
  stage: { height: 128, overflow: "hidden", position: "relative", width: 256 },
  stageTile: {
    alignItems: "center",
    backgroundColor: `${PRIMARY}0d`,
    borderColor: `${PRIMARY}33`,
    borderRadius: 12,
    borderWidth: 1,
    height: 80,
    justifyContent: "center",
    position: "absolute",
    top: 0,
    width: 80,
  },
  stageTileLeft: { left: 0 },
  stageTileRight: { right: 0 },
  successBadge: {
    backgroundColor: `${PRIMARY}1a`,
    borderRadius: 999,
    padding: 16,
  },
  wordmark: {
    bottom: 32,
    color: `${PRIMARY}80`,
    fontFamily: "SofiaProBold",
    fontSize: 36,
    position: "absolute",
  },
});
