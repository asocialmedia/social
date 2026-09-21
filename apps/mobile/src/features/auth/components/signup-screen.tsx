// 1:1 native port of web SignUpForm (components/auth/forms/sign-up-form.tsx).
// Stages: form -> OTP panel -> email-link panel. UI-only: timers, validation,
// and simulated verification replace requestSignup / fetch / Turnstile /
// BroadcastChannel. State lives in SignupStateProvider (replaces nuqs).

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Mail,
  ShieldCheck,
  XCircle,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import asmLogo from "@/assets/images/asm.png";
import signupBgImage from "@/assets/images/signup-image.jpg";
import { GoogleIcon } from "@/components/icons/google-icon";
import { RedditIcon } from "@/components/icons/reddit-icon";
import { validateSignup } from "@/features/auth/lib/auth-validation";
import { useSignupState } from "@/features/auth/state/signup-state";
import {
  ERROR_SHADOWS,
  INPUT_ERROR_SHADOWS,
  INPUT_FOCUS_SHADOWS,
  INPUT_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_SHADOWS,
  SOCIAL_PRESSED_SHADOWS,
  SOCIAL_SHADOWS,
  useAppTheme,
} from "@/theme";

import { OtpInput } from "./otp-input";
import { PasswordStrength } from "./password-strength";

const OTP_EXPIRY_MS = 300_000;
const OTP_RESEND_GATE_MS = 30_000;
const DIGITS_ONLY = /^\d*$/;

function NativeCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      hitSlop={6}
      onPress={() => onChange(!checked)}
      style={[
        styles.checkbox,
        {
          backgroundColor: checked ? "#ff9500" : theme.inputBg,
          borderColor: checked ? "#ff9500" : theme.inputPlaceholder,
          boxShadow: INPUT_SHADOWS,
        },
      ]}
    >
      {checked ? <Check color="#ffffff" size={12} /> : null}
    </Pressable>
  );
}

export default function SignupScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const {
    clearSignupState,
    currentEmail,
    setEmailVerificationState,
    setOTPState,
    stage,
  } = useSignupState();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<
    "email" | "password" | "username" | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    username?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showLoginLink, setShowLoginLink] = useState(false);
  const [isAgeVerified, setIsAgeVerified] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // Native stand-in for Cloudflare Turnstile (web-only widget). UI-only:
  // tapping the box issues a local token that enables Create account.
  const [humanVerified, setHumanVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSocial, setActiveSocial] = useState<"google" | "reddit" | null>(
    null
  );

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const showOTPPanel = stage === "otp" || stage === "email-verify";
  const showEmailVerification = stage === "email-verify";
  // Deadline-based countdowns (same 300s expiry / 30s resend gate as web).
  // A 1s ticker derives the remaining seconds; entering the OTP stage stamps
  // fresh deadlines in the render-adjust block below.
  const [otpDeadline, setOtpDeadline] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (stage !== "otp") {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [stage]);

  const expiryCount = Math.max(0, Math.ceil((otpDeadline - now) / 1000));
  const resendGate = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Clear the OTP input whenever the flow leaves the OTP panel. Uses React's
  // documented adjust-state-during-render pattern (same as the web form) so
  // no effect-driven render is needed.
  const [prevStage, setPrevStage] = useState(stage);
  if (prevStage !== stage) {
    setPrevStage(stage);
    if (stage !== "otp") {
      setOtp("");
      setOtpError(false);
    }
    if (stage === "otp") {
      setTooltipDismissed(false);
    }
  }

  const shakeX = useSharedValue(0);
  const animatedShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));
  const triggerShake = useCallback(() => {
    // oxlint-disable-next-line react/immutability
    shakeX.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-4, { duration: 50 }),
      withTiming(0, { duration: 50 })
    );
  }, [shakeX]);

  const later = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms);
    timersRef.current.push(timer);
  }, []);

  const handleSocialClick = useCallback(
    (provider: "google" | "reddit") => {
      setActiveSocial(provider);
      later(() => setActiveSocial(null), 1000);
    },
    [later]
  );

  const handleSubmit = useCallback(() => {
    setFormError(null);
    setShowLoginLink(false);
    const errors = validateSignup(username, email, password);
    if (errors.username ?? errors.email ?? errors.password) {
      setFieldErrors(errors);
      setFormError(Object.values(errors)[0] ?? "Please check your input");
      triggerShake();
      return;
    }
    setFieldErrors({});
    if (!(isAgeVerified && acceptedTerms)) {
      setFormError(
        "You gotta check those boxes, we can't let just anyone join the squad!"
      );
      triggerShake();
      return;
    }
    if (!humanVerified) {
      setFormError("Complete the security check before creating your account.");
      triggerShake();
      return;
    }
    setIsLoading(true);
    // In-app signup is not wired yet: /api/signup requires a Turnstile token,
    // and the native Turnstile integration has not shipped. Faking success here
    // walked users through an OTP screen that created nothing, so state the
    // limitation plainly and point at the web flow instead.
    setIsLoading(false);
    setFormError(
      "Creating an account in the app isn't available yet. Please sign up at asocialmedia.cc, then log in here."
    );
  }, [
    acceptedTerms,
    email,
    humanVerified,
    isAgeVerified,
    password,
    triggerShake,
    username,
  ]);

  const verifyOtp = useCallback(
    (otpValue: string) => {
      if (otpValue.length !== 6 || isVerifyingOtp || expiryCount === 0) {
        return;
      }
      setIsVerifyingOtp(true);
      setOtpError(false);
      // UI-only: any 6 digits succeed after a beat; "000000" demos the error path.
      later(() => {
        setIsVerifyingOtp(false);
        if (otpValue === "000000") {
          setOtpError(true);
          setOtp("");
          triggerShake();
          return;
        }
        clearSignupState();
        router.replace("/(auth)/login");
      }, 900);
    },
    [clearSignupState, expiryCount, isVerifyingOtp, later, router, triggerShake]
  );

  const handleOtpChange = useCallback(
    (val: string) => {
      if (!DIGITS_ONLY.test(val)) {
        setOtpError(true);
        setFormError("We're looking for digits, not your life story!");
        return;
      }
      setFormError(null);
      setOtpError(false);
      setOtp(val);
      if (val.length === 6) {
        verifyOtp(val);
      }
    },
    [verifyOtp]
  );

  const handleResendOtp = useCallback(() => {
    if (isResending) {
      return;
    }
    setIsResending(true);
    setTooltipDismissed(true);
    later(() => {
      setIsResending(false);
      setOtp("");
      setOtpError(false);
      setTooltipDismissed(false);
      setOtpDeadline(Date.now() + OTP_EXPIRY_MS);
      setResendAvailableAt(Date.now() + OTP_RESEND_GATE_MS);
      setNow(Date.now());
    }, 900);
  }, [isResending, later]);

  const handleVerifyViaEmailLink = useCallback(() => {
    setEmailVerificationState(currentEmail || email.trim());
    setEmailSent(false);
  }, [currentEmail, email, setEmailVerificationState]);

  const handleBackToCodeEntry = useCallback(() => {
    const stampedAt = Date.now();
    setOtpDeadline(stampedAt + OTP_EXPIRY_MS);
    setResendAvailableAt(stampedAt + OTP_RESEND_GATE_MS);
    setNow(stampedAt);
    setOTPState(currentEmail || email.trim());
  }, [currentEmail, email, setOTPState]);

  const handleResendVerificationLink = useCallback(() => {
    if (isResending) {
      return;
    }
    setIsResending(true);
    later(() => {
      setIsResending(false);
      setEmailSent(true);
    }, 900);
  }, [isResending, later]);

  const inputShadow = (field: "email" | "password" | "username") => {
    if (fieldErrors[field]) {
      return INPUT_ERROR_SHADOWS;
    }
    return focusedField === field ? INPUT_FOCUS_SHADOWS : INPUT_SHADOWS;
  };

  return (
    <View
      style={[styles.rootContainer, { backgroundColor: theme.containerBg }]}
    >
      <Image
        blurRadius={Platform.OS === "android" ? 14 : 20}
        contentFit="cover"
        source={signupBgImage}
        style={[StyleSheet.absoluteFill, { opacity: theme.bgImageOpacity }]}
      />
      <LinearGradient
        colors={theme.bgGradient}
        end={{ x: 0.85, y: 1 }}
        start={{ x: 0.15, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView
        edges={["top", "bottom", "left", "right"]}
        style={styles.safeArea}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardAvoid}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View style={[styles.cardWrapper, animatedShakeStyle]}>
              <View
                className="relative w-full rounded-2xl p-6"
                style={[
                  styles.card3d,
                  {
                    backgroundColor: theme.cardBg,
                    borderColor: theme.cardBorder,
                    shadowColor: theme.cardShadow,
                  },
                ]}
              >
                <View className="mb-1 flex-row items-center justify-center gap-2.5">
                  <Image
                    contentFit="contain"
                    source={asmLogo}
                    style={styles.brandLogo}
                  />
                  <Text
                    className="text-3xl tracking-tight text-[#ff9500]"
                    style={styles.fontBold}
                  >
                    Launch Your Journey
                  </Text>
                </View>
                <View
                  className="mx-auto my-3.5 h-px w-16"
                  style={{ backgroundColor: theme.headingDivider }}
                />

                {showOTPPanel ? null : (
                  <View>
                    {formError ? (
                      <View
                        className="mb-3 rounded-xl px-3 py-2"
                        style={{
                          backgroundColor: theme.errorBannerBg,
                          boxShadow: ERROR_SHADOWS,
                        }}
                      >
                        <View className="flex-row items-center justify-center gap-2">
                          <AlertCircle color="#ff7b63" size={15} />
                          <Text
                            className="flex-1 text-center text-xs"
                            style={[
                              styles.fontMedium,
                              { color: theme.errorBannerText },
                            ]}
                          >
                            {formError}
                          </Text>
                        </View>
                        {showLoginLink ? (
                          <Pressable
                            hitSlop={4}
                            onPress={() => router.push("/(auth)/login")}
                          >
                            <Text
                              className="mt-2 text-center text-xs underline"
                              style={[
                                styles.fontMedium,
                                { color: theme.auxLink },
                              ]}
                            >
                              Log in instead
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}

                    {/* Username */}
                    <View className="mb-3">
                      <Text
                        className="mb-1.5 text-sm"
                        style={[styles.fontMedium, { color: theme.inputLabel }]}
                      >
                        Username
                      </Text>
                      <View
                        className="h-10 flex-row items-center rounded-xl px-3.5"
                        style={[
                          styles.inputField,
                          {
                            backgroundColor: fieldErrors.username
                              ? "rgba(255, 123, 99, 0.1)"
                              : theme.inputBg,
                            boxShadow: inputShadow("username"),
                          },
                        ]}
                      >
                        <TextInput
                          autoCapitalize="none"
                          autoCorrect={false}
                          className="flex-1 p-0 text-sm"
                          onBlur={() => setFocusedField(null)}
                          onChangeText={(text) => {
                            setUsername(text);
                            setFormError(null);
                          }}
                          onFocus={() => setFocusedField("username")}
                          placeholder="cooluser"
                          placeholderTextColor={theme.inputPlaceholder}
                          style={[
                            styles.fontRegular,
                            { color: theme.inputText },
                          ]}
                          value={username}
                        />
                        {fieldErrors.username ? (
                          <XCircle color="#ff7b63" size={15} />
                        ) : null}
                      </View>
                      {fieldErrors.username ? (
                        <Text
                          className="mt-1 text-xs"
                          style={[styles.fontRegular, { color: "#ff7b63" }]}
                        >
                          {fieldErrors.username}
                        </Text>
                      ) : null}
                    </View>

                    {/* Email */}
                    <View className="mb-3">
                      <Text
                        className="mb-1.5 text-sm"
                        style={[styles.fontMedium, { color: theme.inputLabel }]}
                      >
                        Email
                      </Text>
                      <View
                        className="h-10 flex-row items-center rounded-xl px-3.5"
                        style={[
                          styles.inputField,
                          {
                            backgroundColor: fieldErrors.email
                              ? "rgba(255, 123, 99, 0.1)"
                              : theme.inputBg,
                            boxShadow: inputShadow("email"),
                          },
                        ]}
                      >
                        <TextInput
                          autoCapitalize="none"
                          autoCorrect={false}
                          className="flex-1 p-0 text-sm"
                          keyboardType="email-address"
                          onBlur={() => setFocusedField(null)}
                          onChangeText={(text) => {
                            setEmail(text);
                            setFormError(null);
                          }}
                          onFocus={() => setFocusedField("email")}
                          placeholder="you@example.com"
                          placeholderTextColor={theme.inputPlaceholder}
                          style={[
                            styles.fontRegular,
                            { color: theme.inputText },
                          ]}
                          value={email}
                        />
                        {fieldErrors.email ? (
                          <XCircle color="#ff7b63" size={15} />
                        ) : null}
                      </View>
                      {fieldErrors.email ? (
                        <Text
                          className="mt-1 text-xs"
                          style={[styles.fontRegular, { color: "#ff7b63" }]}
                        >
                          {fieldErrors.email}
                        </Text>
                      ) : null}
                    </View>

                    {/* Password */}
                    <View className="mb-1">
                      <Text
                        className="mb-1.5 text-sm"
                        style={[styles.fontMedium, { color: theme.inputLabel }]}
                      >
                        Password
                      </Text>
                      <View
                        className="h-10 flex-row items-center rounded-xl px-3.5"
                        style={[
                          styles.inputField,
                          {
                            backgroundColor: fieldErrors.password
                              ? "rgba(255, 123, 99, 0.1)"
                              : theme.inputBg,
                            boxShadow: inputShadow("password"),
                          },
                        ]}
                      >
                        <TextInput
                          autoCapitalize="none"
                          autoCorrect={false}
                          className="flex-1 p-0 text-sm"
                          onBlur={() => setFocusedField(null)}
                          onChangeText={(text) => {
                            setPassword(text);
                            setFormError(null);
                          }}
                          onFocus={() => setFocusedField("password")}
                          placeholder="••••••••"
                          placeholderTextColor={theme.inputPlaceholder}
                          secureTextEntry={!showPassword}
                          style={[
                            styles.fontRegular,
                            { color: theme.inputText },
                          ]}
                          value={password}
                        />
                        <Pressable
                          hitSlop={8}
                          onPress={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff color={theme.eyeIcon} size={16} />
                          ) : (
                            <Eye color={theme.eyeIcon} size={16} />
                          )}
                        </Pressable>
                      </View>
                      <PasswordStrength password={password} />
                      {fieldErrors.password ? (
                        <Text
                          className="mt-1 text-xs"
                          style={[styles.fontRegular, { color: "#ff7b63" }]}
                        >
                          {fieldErrors.password}
                        </Text>
                      ) : null}
                    </View>

                    {/* Age + Terms */}
                    <View className="mt-3 gap-3">
                      <View className="flex-row items-center gap-2.5">
                        <NativeCheckbox
                          checked={isAgeVerified}
                          onChange={setIsAgeVerified}
                        />
                        <Text
                          className="flex-1 text-sm"
                          style={[
                            styles.fontRegular,
                            { color: theme.dividerText },
                          ]}
                        >
                          Yes, I&apos;ve survived enough birthdays to be here
                        </Text>
                      </View>
                      <View className="flex-row items-start gap-2.5">
                        <View className="mt-0.5">
                          <NativeCheckbox
                            checked={acceptedTerms}
                            onChange={setAcceptedTerms}
                          />
                        </View>
                        <Text
                          className="flex-1 text-sm leading-5"
                          style={[
                            styles.fontRegular,
                            { color: theme.dividerText },
                          ]}
                        >
                          I agree to the{" "}
                          <Text
                            onPress={() => {
                              void WebBrowser.openBrowserAsync(
                                "https://asocialmedia.cc/toc"
                              );
                            }}
                            style={[styles.fontMedium, { color: "#ff9500" }]}
                          >
                            Terms of Service
                          </Text>{" "}
                          and{" "}
                          <Text
                            onPress={() => {
                              void WebBrowser.openBrowserAsync(
                                "https://asocialmedia.cc/privacy"
                              );
                            }}
                            style={[styles.fontMedium, { color: "#ff9500" }]}
                          >
                            Privacy Policy
                          </Text>
                        </Text>
                      </View>

                      {/* Turnstile stand-in (web uses Cloudflare Turnstile) */}
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: humanVerified }}
                        onPress={() => setHumanVerified(!humanVerified)}
                        style={[
                          styles.turnstile,
                          {
                            backgroundColor: theme.inputBg,
                            boxShadow: INPUT_SHADOWS,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.turnstileBox,
                            {
                              backgroundColor: humanVerified
                                ? "#ff9500"
                                : "transparent",
                              borderColor: humanVerified
                                ? "#ff9500"
                                : theme.inputPlaceholder,
                            },
                          ]}
                        >
                          {humanVerified ? (
                            <Check color="#ffffff" size={14} />
                          ) : null}
                        </View>
                        <View className="flex-1">
                          <Text
                            className="text-sm"
                            style={[
                              styles.fontMedium,
                              { color: theme.inputLabel },
                            ]}
                          >
                            I&apos;m not a robot
                          </Text>
                          <Text
                            className="text-xs"
                            style={[
                              styles.fontRegular,
                              { color: theme.dividerText },
                            ]}
                          >
                            Complete the security check to create your account.
                          </Text>
                        </View>
                        {humanVerified ? (
                          <Check color="#22c55e" size={20} />
                        ) : (
                          <ShieldCheck color={theme.eyeIcon} size={20} />
                        )}
                      </Pressable>

                      <Pressable
                        disabled={isLoading}
                        onPress={handleSubmit}
                        style={styles.btnFullWidth}
                      >
                        {({ pressed }) => (
                          <View
                            style={[
                              styles.loginBtn,
                              {
                                boxShadow: pressed
                                  ? LOGIN_BUTTON_PRESSED_SHADOWS
                                  : LOGIN_BUTTON_SHADOWS,
                                opacity: humanVerified ? 1 : 0.6,
                              },
                              pressed && styles.pressedShift,
                            ]}
                          >
                            <LinearGradient
                              colors={["#ff9500", "#e65500"]}
                              end={{ x: 0.5, y: 1 }}
                              start={{ x: 0.5, y: 0 }}
                              style={styles.loginBtnGradient}
                            >
                              {isLoading ? (
                                <ActivityIndicator
                                  color="#ffffff"
                                  size="small"
                                />
                              ) : null}
                              <Text
                                className="text-base tracking-tight text-white"
                                style={styles.loginBtnText}
                              >
                                Create account
                              </Text>
                            </LinearGradient>
                          </View>
                        )}
                      </Pressable>
                    </View>

                    {/* or continue with */}
                    <View className="my-3.5 flex-row items-center">
                      <View
                        className="h-px flex-1"
                        style={{ backgroundColor: theme.dividerLine }}
                      />
                      <Text
                        className="px-2.5 text-xs"
                        style={[
                          styles.fontMedium,
                          { color: theme.dividerText },
                        ]}
                      >
                        or continue with
                      </Text>
                      <View
                        className="h-px flex-1"
                        style={{ backgroundColor: theme.dividerLine }}
                      />
                    </View>
                    <View className="w-full gap-2">
                      <Pressable
                        disabled={activeSocial !== null || isLoading}
                        onPress={() => handleSocialClick("google")}
                        style={styles.btnFullWidth}
                      >
                        {({ pressed }) => (
                          <View
                            style={[
                              styles.socialBtn,
                              {
                                backgroundColor: pressed
                                  ? theme.socialBtnPressedBg
                                  : theme.socialBtnBg,
                                boxShadow: pressed
                                  ? SOCIAL_PRESSED_SHADOWS
                                  : SOCIAL_SHADOWS,
                              },
                              pressed && styles.pressedShift,
                            ]}
                          >
                            {activeSocial === "google" ? (
                              <ActivityIndicator
                                color={theme.socialBtnText}
                                size="small"
                              />
                            ) : (
                              <GoogleIcon size={16} />
                            )}
                            <Text
                              className="text-sm"
                              style={[
                                styles.fontMedium,
                                { color: theme.socialBtnText },
                              ]}
                            >
                              Continue with Google
                            </Text>
                          </View>
                        )}
                      </Pressable>
                      <Pressable
                        disabled={activeSocial !== null || isLoading}
                        onPress={() => handleSocialClick("reddit")}
                        style={styles.btnFullWidth}
                      >
                        {({ pressed }) => (
                          <View
                            style={[
                              styles.socialBtn,
                              {
                                backgroundColor: pressed
                                  ? theme.socialBtnPressedBg
                                  : theme.socialBtnBg,
                                boxShadow: pressed
                                  ? SOCIAL_PRESSED_SHADOWS
                                  : SOCIAL_SHADOWS,
                              },
                              pressed && styles.pressedShift,
                            ]}
                          >
                            {activeSocial === "reddit" ? (
                              <ActivityIndicator
                                color={theme.socialBtnText}
                                size="small"
                              />
                            ) : (
                              <RedditIcon size={16} />
                            )}
                            <Text
                              className="text-sm"
                              style={[
                                styles.fontMedium,
                                { color: theme.socialBtnText },
                              ]}
                            >
                              Continue with Reddit
                            </Text>
                          </View>
                        )}
                      </Pressable>
                    </View>

                    <View className="mt-5 items-center">
                      <Pressable
                        hitSlop={6}
                        onPress={() => router.push("/(auth)/login")}
                      >
                        <Text
                          className="text-sm text-[#ff9500]"
                          style={styles.fontMedium}
                        >
                          Already have an account? Login
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {showOTPPanel && !showEmailVerification ? (
                  <View className="gap-4">
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="min-w-0 flex-1 gap-1">
                        <Text
                          className="text-lg font-bold"
                          style={[styles.fontBold, { color: theme.inputLabel }]}
                        >
                          Verify Your Email
                        </Text>
                        <Text
                          className="text-xs"
                          style={[
                            styles.fontRegular,
                            { color: theme.dividerText },
                          ]}
                        >
                          Enter the 6-digit code sent to
                        </Text>
                        <Text
                          className="text-xs"
                          numberOfLines={1}
                          style={[
                            styles.fontMedium,
                            { color: theme.inputLabel },
                          ]}
                        >
                          {currentEmail || email.trim()}
                        </Text>
                      </View>
                      <Pressable
                        disabled={expiryCount > 0 || isResending}
                        hitSlop={8}
                        onPress={handleResendOtp}
                        style={[
                          styles.timerButton,
                          {
                            backgroundColor: theme.inputBg,
                            boxShadow: INPUT_SHADOWS,
                          },
                        ]}
                      >
                        <Text
                          className="text-center text-xs"
                          style={[
                            styles.fontMedium,
                            { color: theme.inputLabel },
                          ]}
                        >
                          {expiryCount > 0
                            ? `${Math.floor(expiryCount / 60)}:${String(expiryCount % 60).padStart(2, "0")}`
                            : "↻"}
                        </Text>
                      </Pressable>
                    </View>

                    {expiryCount === 0 && !tooltipDismissed ? (
                      <View
                        className="rounded-xl px-3 py-2"
                        style={{
                          backgroundColor: theme.errorBannerBg,
                          boxShadow: ERROR_SHADOWS,
                        }}
                      >
                        <Text
                          className="text-center text-xs"
                          style={[
                            styles.fontMedium,
                            { color: theme.errorBannerText },
                          ]}
                        >
                          Code expired! Tap the timer button to resend a new
                          verification code.
                        </Text>
                      </View>
                    ) : null}

                    <View className="gap-2">
                      <OtpInput
                        disabled={isVerifyingOtp || expiryCount === 0}
                        hasError={otpError}
                        onChange={handleOtpChange}
                        value={otp}
                      />
                      {isVerifyingOtp ? (
                        <View className="flex-row items-center justify-center gap-2">
                          <ActivityIndicator color="#ff9500" size="small" />
                          <Text
                            className="text-sm"
                            style={[styles.fontMedium, { color: "#ff9500" }]}
                          >
                            Verifying your code...
                          </Text>
                        </View>
                      ) : null}
                      {otpError && !isVerifyingOtp ? (
                        <View className="flex-row items-center justify-center gap-2">
                          <AlertCircle color="#ff7b63" size={15} />
                          <Text
                            className="text-sm"
                            style={[styles.fontMedium, { color: "#ff7b63" }]}
                          >
                            That code didn&apos;t work. Please try again.
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <View className="gap-2">
                      {resendGate === 0 ? (
                        <Pressable
                          disabled={isResending}
                          onPress={handleResendOtp}
                          style={styles.btnFullWidth}
                        >
                          {({ pressed }) => (
                            <View
                              style={[
                                styles.loginBtn,
                                {
                                  boxShadow: pressed
                                    ? LOGIN_BUTTON_PRESSED_SHADOWS
                                    : LOGIN_BUTTON_SHADOWS,
                                },
                                pressed && styles.pressedShift,
                              ]}
                            >
                              <LinearGradient
                                colors={["#ff9500", "#e65500"]}
                                end={{ x: 0.5, y: 1 }}
                                start={{ x: 0.5, y: 0 }}
                                style={styles.loginBtnGradient}
                              >
                                {isResending ? (
                                  <ActivityIndicator
                                    color="#ffffff"
                                    size="small"
                                  />
                                ) : null}
                                <Text
                                  className="text-base tracking-tight text-white"
                                  style={styles.loginBtnText}
                                >
                                  {isResending ? "Sending..." : "Resend Code"}
                                </Text>
                              </LinearGradient>
                            </View>
                          )}
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={handleVerifyViaEmailLink}
                        style={[
                          styles.ghostBtn,
                          {
                            backgroundColor: theme.socialBtnBg,
                            boxShadow: SOCIAL_SHADOWS,
                          },
                        ]}
                      >
                        <Text
                          className="text-sm"
                          style={[
                            styles.fontMedium,
                            { color: theme.socialBtnText },
                          ]}
                        >
                          Verify via Email Link Instead
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {showEmailVerification ? (
                  <View className="gap-4">
                    <Pressable
                      hitSlop={6}
                      onPress={handleBackToCodeEntry}
                      style={styles.backRow}
                    >
                      <ArrowLeft color={theme.dividerText} size={16} />
                      <Text
                        className="text-sm"
                        style={[
                          styles.fontMedium,
                          { color: theme.dividerText },
                        ]}
                      >
                        Back to Code Entry
                      </Text>
                    </Pressable>
                    <View className="items-center gap-2">
                      <View
                        style={[
                          styles.mailBadge,
                          {
                            backgroundColor: theme.inputBg,
                            boxShadow: SOCIAL_SHADOWS,
                          },
                        ]}
                      >
                        <Mail color="#ff9500" size={28} />
                      </View>
                      <Text
                        className="text-2xl"
                        style={[styles.fontBold, { color: "#ff9500" }]}
                      >
                        Check Your Email
                      </Text>
                    </View>
                    <View className="gap-2">
                      <Text
                        className="text-center text-sm"
                        style={[
                          styles.fontRegular,
                          { color: theme.dividerText },
                        ]}
                      >
                        We&apos;ve sent a verification link to
                      </Text>
                      <Text
                        className="rounded-lg px-4 py-2 text-center"
                        style={[
                          styles.fontMedium,
                          {
                            backgroundColor: theme.inputBg,
                            color: theme.inputLabel,
                          },
                        ]}
                      >
                        {currentEmail || email.trim()}
                      </Text>
                      {emailSent ? (
                        <Text
                          className="text-center text-xs"
                          style={[styles.fontMedium, { color: "#22c55e" }]}
                        >
                          Email sent! Check your inbox (and spam folder, just in
                          case).
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      disabled={isResending}
                      onPress={handleResendVerificationLink}
                      style={styles.btnFullWidth}
                    >
                      {({ pressed }) => (
                        <View
                          style={[
                            styles.loginBtn,
                            {
                              boxShadow: pressed
                                ? LOGIN_BUTTON_PRESSED_SHADOWS
                                : LOGIN_BUTTON_SHADOWS,
                            },
                            pressed && styles.pressedShift,
                          ]}
                        >
                          <LinearGradient
                            colors={["#ff9500", "#e65500"]}
                            end={{ x: 0.5, y: 1 }}
                            start={{ x: 0.5, y: 0 }}
                            style={styles.loginBtnGradient}
                          >
                            {isResending ? (
                              <ActivityIndicator color="#ffffff" size="small" />
                            ) : null}
                            <Text
                              className="text-base tracking-tight text-white"
                              style={styles.loginBtnText}
                            >
                              {isResending
                                ? "Sending..."
                                : "Resend verification email"}
                            </Text>
                          </LinearGradient>
                        </View>
                      )}
                    </Pressable>
                    <Text
                      className="text-center text-xs"
                      style={[styles.fontRegular, { color: theme.dividerText }]}
                    >
                      Please check your inbox to complete your registration or
                      check your spam folder if you don&apos;t see the email in
                      your inbox
                    </Text>
                  </View>
                ) : null}
              </View>

              <Pressable
                className="mt-4 flex-row items-center justify-center gap-1.5 py-1"
                hitSlop={6}
                onPress={() => router.replace("/")}
              >
                <ArrowLeft color={theme.guestLink} size={15} />
                <Text
                  className="text-sm"
                  style={[styles.fontMedium, { color: theme.guestLink }]}
                >
                  Skip for now — continue browsing as guest
                </Text>
              </Pressable>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  brandLogo: {
    height: 32,
    width: 44,
  },
  btnFullWidth: {
    width: "100%",
  },
  card3d: {
    borderRadius: 16,
    borderWidth: 1,
    ...Platform.select({
      android: { elevation: 3 },
      ios: {
        shadowOffset: { height: 8, width: 0 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
    }),
  },
  cardWrapper: {
    maxWidth: 384,
    width: "100%",
  },
  checkbox: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  fontBold: {
    fontFamily: "SofiaProBold",
    fontWeight: "normal",
  },
  fontMedium: {
    fontFamily: "SofiaProMed",
    fontWeight: "normal",
  },
  fontRegular: {
    fontFamily: "SofiaProReg",
    fontWeight: "normal",
  },
  ghostBtn: {
    alignItems: "center",
    borderRadius: 12,
    height: 44,
    justifyContent: "center",
    width: "100%",
  },
  inputField: {
    borderRadius: 12,
  },
  keyboardAvoid: {
    flex: 1,
  },
  loginBtn: {
    borderRadius: 9999,
  },
  loginBtnGradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 8,
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  loginBtnText: {
    fontFamily: "SofiaProBold",
    fontWeight: "normal",
    letterSpacing: -0.3,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  mailBadge: {
    alignItems: "center",
    borderRadius: 9999,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  rootContainer: {
    flex: 1,
    height: "100%",
    width: "100%",
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  socialBtn: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
  timerButton: {
    alignItems: "center",
    borderRadius: 9999,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  turnstile: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  turnstileBox: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
});
