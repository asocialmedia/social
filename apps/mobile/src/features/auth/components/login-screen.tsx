import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Mail,
  ShieldCheck,
  XCircle,
} from "lucide-react-native";
import { useCallback, useState } from "react";
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
import loginBgImage from "@/assets/images/login-image.jpg";
import { GoogleIcon } from "@/components/icons/google-icon";
import { RedditIcon } from "@/components/icons/reddit-icon";
import { AuthPrimaryButton } from "@/features/auth/components/auth-primary-button";
import { OtpInput } from "@/features/auth/components/otp-input";
import { authClient } from "@/features/auth/lib/auth-client";
import {
  describeAuthError,
  describeOAuthRedirectError,
} from "@/features/auth/lib/auth-errors";
import { useSessionContext } from "@/features/auth/state/session";
import {
  ERROR_SHADOWS,
  ICON_BUTTON_SHADOWS_DARK,
  ICON_BUTTON_SHADOWS_LIGHT,
  INPUT_ERROR_SHADOWS,
  INPUT_FOCUS_SHADOWS,
  INPUT_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_SHADOWS,
  SOCIAL_PRESSED_SHADOWS,
  SOCIAL_SHADOWS,
  useAppTheme,
} from "@/theme";

function getPressedBg(
  pressed: boolean,
  defaultBg: string,
  pressedBg: string
): string {
  return pressed ? pressedBg : defaultBg;
}

function getInputShadow(hasError: boolean, isFocused: boolean): string {
  if (hasError) {
    return INPUT_ERROR_SHADOWS;
  }
  return isFocused ? INPUT_FOCUS_SHADOWS : INPUT_SHADOWS;
}

export default function LoginScreen() {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isFocusedUser, setIsFocusedUser] = useState(false);
  const [isFocusedPass, setIsFocusedPass] = useState(false);
  const { signIn, signInPasskey, signInSocial } = useSessionContext();
  // A failed provider callback deep-links back here as /login?error=<code>
  // (mirrors the web's /login/error page). A cold start lands with the param
  // already set, so it seeds the banner; while the screen is up, the session
  // provider captures the same URL itself and returns the message directly.
  const { error: redirectErrorCode } = useLocalSearchParams<{
    error?: string;
  }>();
  const [error, setError] = useState<string | null>(() =>
    describeOAuthRedirectError(redirectErrorCode)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [activeSocial, setActiveSocial] = useState<
    "google" | "reddit" | "passkey" | null
  >(null);
  // Inline 2FA challenge (mirrors web InlineTwoFactorForm copy).
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorMethod, setTwoFactorMethod] = useState<"email" | "totp">(
    "totp"
  );
  const [code, setCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const shakeTranslateX = useSharedValue(0);

  const animatedShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeTranslateX.value }],
  }));

  const triggerShake = useCallback(() => {
    // oxlint-disable-next-line react/immutability
    shakeTranslateX.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-4, { duration: 50 }),
      withTiming(0, { duration: 50 })
    );
  }, [shakeTranslateX]);

  const handleLogin = useCallback(async () => {
    if (!username.trim() || !password.trim()) {
      setError("Invalid username/email or password");
      triggerShake();
      return;
    }

    setError(null);
    setTwoFactorRequired(false);
    // No human check here (Turnstile is signup-only); the session provider
    // only shows the install gate if the server explicitly demands a token,
    // and resumes the request afterwards, so the spinner stays on until it
    // settles.
    setIsLoading(true);
    const result = await signIn(username, password);
    setIsLoading(false);
    if (result.ok) {
      router.replace("/");
      return;
    }
    if ("twoFactor" in result) {
      setTwoFactorRequired(true);
      setCode("");
      setEmailSent(false);
      return;
    }
    if ("cancelled" in result) {
      return;
    }
    setError(result.error);
    triggerShake();
  }, [router, signIn, password, triggerShake, username]);

  const handleSendEmailCode = useCallback(async () => {
    setIsVerifying(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.sendOtp({ trustDevice: false });
      if (result.error) {
        setError(
          describeAuthError(
            result.error,
            "We couldn't send a security code. Try again."
          ).message
        );
      } else {
        setEmailSent(true);
      }
    } catch {
      setError("We couldn't send a security code. Try again.");
    }
    setIsVerifying(false);
  }, []);

  const handleVerifyCode = useCallback(
    async (value?: string) => {
      const normalized = (value ?? code).trim();
      if (!normalized || isVerifying) {
        return;
      }
      setIsVerifying(true);
      setError(null);
      try {
        const result =
          twoFactorMethod === "email"
            ? await authClient.twoFactor.verifyOtp({
                code: normalized,
                trustDevice: false,
              })
            : await authClient.twoFactor.verifyTotp({
                code: normalized,
                trustDevice: false,
              });
        if (result.error) {
          setError(
            describeAuthError(
              result.error,
              "That code could not be verified. Try again."
            ).message
          );
          triggerShake();
        } else {
          router.replace("/");
        }
      } catch {
        setError("We couldn't verify that code. Try again.");
        triggerShake();
      }
      setIsVerifying(false);
    },
    [code, isVerifying, router, triggerShake, twoFactorMethod]
  );

  const handleOtpChange = useCallback(
    (value: string) => {
      setCode(value);
      if (/^\d{6}$/.test(value)) {
        void handleVerifyCode(value);
      }
    },
    [handleVerifyCode]
  );

  const handleSocialClick = useCallback(
    async (provider: "google" | "reddit") => {
      setActiveSocial(provider);
      setError(null);
      const result = await signInSocial(provider);
      setActiveSocial(null);
      if (result.ok) {
        router.replace("/");
        return;
      }
      if ("cancelled" in result) {
        return;
      }
      setError(result.error);
      triggerShake();
    },
    [router, signInSocial, triggerShake]
  );

  const handlePasskeyClick = useCallback(async () => {
    setActiveSocial("passkey");
    setError(null);
    const result = await signInPasskey();
    setActiveSocial(null);
    if (result.ok) {
      router.replace("/");
      return;
    }
    if ("twoFactor" in result || "cancelled" in result) {
      return;
    }
    setError(result.error);
    triggerShake();
  }, [router, signInPasskey, triggerShake]);

  return (
    <View
      style={[styles.rootContainer, { backgroundColor: theme.containerBg }]}
    >
      {/* Full-bleed atmospheric wallpaper image extending to full screen height */}
      <Image
        blurRadius={Platform.OS === "android" ? 14 : 20}
        contentFit="cover"
        source={loginBgImage}
        style={[StyleSheet.absoluteFill, { opacity: theme.bgImageOpacity }]}
      />

      {/* Full-bleed atmospheric gradient overlay */}
      <LinearGradient
        colors={theme.bgGradient}
        end={{ x: 0.85, y: 1 }}
        start={{ x: 0.15, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Safe area layout strictly for interactive form content */}
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
            <Animated.View
              style={[styles.animatedCardWrapper, animatedShakeStyle]}
            >
              {/* 3D Tactile Card (surface-3d) */}
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
                {/* Header: Logo + Welcome Back */}
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
                    Welcome Back
                  </Text>
                </View>

                {/* Mobile divider under heading */}
                <View
                  className="mx-auto my-3.5 h-px w-16"
                  style={{ backgroundColor: theme.headingDivider }}
                />

                {/* Social Login Buttons */}
                <View className="w-full gap-2">
                  {/* Google Button */}
                  <Pressable
                    disabled={activeSocial !== null || isLoading}
                    onPress={() => {
                      void handleSocialClick("google");
                    }}
                    style={styles.btnFullWidth}
                  >
                    {({ pressed }) => (
                      <View
                        style={[
                          styles.socialBtn3d,
                          {
                            backgroundColor: getPressedBg(
                              pressed,
                              theme.socialBtnBg,
                              theme.socialBtnPressedBg
                            ),
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

                  {/* Reddit Button */}
                  <Pressable
                    disabled={activeSocial !== null || isLoading}
                    onPress={() => {
                      void handleSocialClick("reddit");
                    }}
                    style={styles.btnFullWidth}
                  >
                    {({ pressed }) => (
                      <View
                        style={[
                          styles.socialBtn3d,
                          {
                            backgroundColor: getPressedBg(
                              pressed,
                              theme.socialBtnBg,
                              theme.socialBtnPressedBg
                            ),
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

                {/* "OR" Divider */}
                <View className="my-3.5 flex-row items-center">
                  <View
                    className="h-px flex-1"
                    style={{ backgroundColor: theme.dividerLine }}
                  />
                  <Text
                    className="px-2.5 text-xs tracking-wider"
                    style={[styles.fontMedium, { color: theme.dividerText }]}
                  >
                    OR
                  </Text>
                  <View
                    className="h-px flex-1"
                    style={{ backgroundColor: theme.dividerLine }}
                  />
                </View>

                {/* Error Banner (premium-error) */}
                {error ? (
                  <View
                    className="mb-3 flex-row items-center justify-center gap-2 rounded-xl px-3 py-2"
                    style={{
                      backgroundColor: theme.errorBannerBg,
                      boxShadow: ERROR_SHADOWS,
                    }}
                  >
                    <AlertCircle color="#ff7b63" size={15} />
                    <Text
                      className="text-xs"
                      style={[
                        styles.fontMedium,
                        { color: theme.errorBannerText },
                      ]}
                    >
                      {error}
                    </Text>
                  </View>
                ) : null}

                {twoFactorRequired ? (
                  <View className="gap-3">
                    <View className="flex-row items-start gap-3">
                      <View className="h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ff9500]">
                        <ShieldCheck color="#ffffff" size={20} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text
                          className="text-base"
                          style={[styles.fontBold, { color: theme.inputLabel }]}
                        >
                          One more step
                        </Text>
                        <Text
                          className="mt-0.5 text-sm"
                          style={[
                            styles.fontRegular,
                            { color: theme.dividerText },
                          ]}
                        >
                          Verify it&apos;s you to finish signing in.
                        </Text>
                      </View>
                      <Pressable
                        hitSlop={6}
                        onPress={() => setTwoFactorRequired(false)}
                      >
                        <Text
                          className="text-xs"
                          style={[
                            styles.fontMedium,
                            { color: theme.dividerText },
                          ]}
                        >
                          Back
                        </Text>
                      </Pressable>
                    </View>

                    <View className="flex-row gap-2">
                      <Pressable
                        hitSlop={4}
                        onPress={() => {
                          setTwoFactorMethod("totp");
                          setCode("");
                          setError(null);
                          // Switching method invalidates "a code was already
                          // emailed"; otherwise returning to Email hides the
                          // send button and looks like a code is in flight.
                          setEmailSent(false);
                        }}
                        style={[
                          styles.methodChip,
                          {
                            backgroundColor:
                              twoFactorMethod === "totp"
                                ? "#ff9500"
                                : theme.socialBtnBg,
                            boxShadow: SOCIAL_SHADOWS,
                          },
                        ]}
                      >
                        <KeyRound
                          color={
                            twoFactorMethod === "totp"
                              ? "#ffffff"
                              : theme.socialBtnText
                          }
                          size={14}
                        />
                        <Text
                          className="text-xs"
                          style={[
                            styles.fontMedium,
                            {
                              color:
                                twoFactorMethod === "totp"
                                  ? "#ffffff"
                                  : theme.socialBtnText,
                            },
                          ]}
                        >
                          Authenticator
                        </Text>
                      </Pressable>
                      <Pressable
                        hitSlop={4}
                        onPress={() => {
                          setTwoFactorMethod("email");
                          setCode("");
                          setError(null);
                          setEmailSent(false);
                        }}
                        style={[
                          styles.methodChip,
                          {
                            backgroundColor:
                              twoFactorMethod === "email"
                                ? "#ff9500"
                                : theme.socialBtnBg,
                            boxShadow: SOCIAL_SHADOWS,
                          },
                        ]}
                      >
                        <Mail
                          color={
                            twoFactorMethod === "email"
                              ? "#ffffff"
                              : theme.socialBtnText
                          }
                          size={14}
                        />
                        <Text
                          className="text-xs"
                          style={[
                            styles.fontMedium,
                            {
                              color:
                                twoFactorMethod === "email"
                                  ? "#ffffff"
                                  : theme.socialBtnText,
                            },
                          ]}
                        >
                          Email code
                        </Text>
                      </Pressable>
                    </View>

                    <Text
                      className="text-sm"
                      style={[styles.fontRegular, { color: theme.dividerText }]}
                    >
                      {twoFactorMethod === "email"
                        ? "We'll send a six-digit code to your verified email address."
                        : "Enter the six-digit code from your authenticator app."}
                    </Text>

                    {twoFactorMethod === "email" && !emailSent ? (
                      <AuthPrimaryButton
                        label={
                          isVerifying ? "Sending..." : "Send security code"
                        }
                        loading={isVerifying}
                        onPress={() => {
                          void handleSendEmailCode();
                        }}
                      />
                    ) : null}

                    <OtpInput
                      disabled={
                        isVerifying ||
                        (twoFactorMethod === "email" && !emailSent)
                      }
                      hasError={error !== null}
                      onChange={handleOtpChange}
                      value={code}
                    />

                    <AuthPrimaryButton
                      label={
                        isVerifying ? "Verifying..." : "Verify and sign in"
                      }
                      loading={isVerifying}
                      onPress={() => {
                        void handleVerifyCode();
                      }}
                    />
                  </View>
                ) : (
                  <>
                    {/* Form: Username or Email */}
                    <View className="mb-3">
                      <Text
                        className="mb-1.5 text-sm"
                        style={[styles.fontMedium, { color: theme.inputLabel }]}
                      >
                        Username or Email
                      </Text>
                      <View
                        className="h-10 flex-row items-center rounded-xl px-3.5"
                        style={[
                          styles.inputField3d,
                          {
                            backgroundColor: error
                              ? "rgba(255, 123, 99, 0.1)"
                              : theme.inputBg,
                            boxShadow: getInputShadow(
                              error !== null,
                              isFocusedUser
                            ),
                          },
                        ]}
                      >
                        <TextInput
                          autoCapitalize="none"
                          autoCorrect={false}
                          className="flex-1 p-0 text-sm"
                          onBlur={() => setIsFocusedUser(false)}
                          onChangeText={(text) => {
                            setUsername(text);
                            if (error) {
                              setError(null);
                            }
                          }}
                          onFocus={() => setIsFocusedUser(true)}
                          placeholder="cooluser or email@cool.user"
                          placeholderTextColor={theme.inputPlaceholder}
                          style={[
                            styles.fontRegular,
                            { color: theme.inputText },
                          ]}
                          value={username}
                        />
                        {error ? <XCircle color="#ff7b63" size={15} /> : null}
                      </View>
                    </View>

                    {/* Form: Password */}
                    <View className="mb-3">
                      <Text
                        className="mb-1.5 text-sm"
                        style={[styles.fontMedium, { color: theme.inputLabel }]}
                      >
                        Password
                      </Text>
                      <View
                        className="h-10 flex-row items-center rounded-xl px-3.5"
                        style={[
                          styles.inputField3d,
                          {
                            backgroundColor: error
                              ? "rgba(255, 123, 99, 0.1)"
                              : theme.inputBg,
                            boxShadow: getInputShadow(
                              error !== null,
                              isFocusedPass
                            ),
                          },
                        ]}
                      >
                        <TextInput
                          autoCapitalize="none"
                          autoCorrect={false}
                          className="flex-1 p-0 text-sm"
                          onBlur={() => setIsFocusedPass(false)}
                          onChangeText={(text) => {
                            setPassword(text);
                            if (error) {
                              setError(null);
                            }
                          }}
                          onFocus={() => setIsFocusedPass(true)}
                          placeholder="supersecret"
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
                    </View>

                    {/* Auxiliary links: Forgot password & Need help */}
                    <View className="mt-0.5 mb-3 flex-row items-center justify-end">
                      <Pressable
                        hitSlop={4}
                        onPress={() => router.push("/(auth)/reset-password")}
                      >
                        <Text
                          className="text-xs"
                          style={[styles.fontMedium, { color: theme.auxLink }]}
                        >
                          Forgot your password?
                        </Text>
                      </Pressable>
                      <Text
                        className="mx-1 text-xs"
                        style={[
                          styles.fontMedium,
                          { color: theme.auxLinkSeparator },
                        ]}
                      >
                        or
                      </Text>
                      <Pressable
                        hitSlop={4}
                        onPress={() => router.push("/(auth)/help")}
                      >
                        <Text
                          className="text-xs"
                          style={[styles.fontMedium, { color: theme.auxLink }]}
                        >
                          Need help?
                        </Text>
                      </Pressable>
                    </View>

                    {/* Actions Row: 3D Log in + 3D Passkey Button */}
                    <View className="flex-row items-center gap-2">
                      {/* 3D Log in Button (btn-3d) */}
                      <Pressable
                        className="flex-1"
                        disabled={isLoading}
                        onPress={() => {
                          void handleLogin();
                        }}
                      >
                        {({ pressed }) => (
                          <View
                            style={[
                              styles.loginBtn3d,
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
                                Log in
                              </Text>
                            </LinearGradient>
                          </View>
                        )}
                      </Pressable>

                      {/* 3D Passkey Button (icon-btn-3d) */}
                      <Pressable
                        disabled={activeSocial !== null || isLoading}
                        onPress={() => {
                          void handlePasskeyClick();
                        }}
                      >
                        {({ pressed }) => (
                          <View
                            style={[
                              styles.passkeyBtn3d,
                              {
                                backgroundColor: getPressedBg(
                                  pressed,
                                  theme.passkeyBg,
                                  isDark ? "#202020" : "#e5e7eb"
                                ),
                                boxShadow: isDark
                                  ? ICON_BUTTON_SHADOWS_DARK
                                  : ICON_BUTTON_SHADOWS_LIGHT,
                              },
                              pressed && styles.pressedShift,
                            ]}
                          >
                            {activeSocial === "passkey" ? (
                              <ActivityIndicator color="#ff9500" size="small" />
                            ) : (
                              <Fingerprint
                                color={theme.passkeyIcon}
                                size={20}
                              />
                            )}
                          </View>
                        )}
                      </Pressable>
                    </View>
                  </>
                )}

                {/* Sign Up Link */}
                <View className="mt-5 items-center">
                  <Pressable
                    hitSlop={6}
                    onPress={() => router.push("/(auth)/signup")}
                  >
                    <Text
                      className="text-sm text-[#ff9500]"
                      style={styles.fontMedium}
                    >
                      Don't have an account? Sign Up
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Bottom Guest Link */}
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
  animatedCardWrapper: {
    maxWidth: 384,
    width: "100%",
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
      android: {
        elevation: 3,
      },
      ios: {
        shadowOffset: { height: 8, width: 0 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
    }),
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
  inputField3d: {
    borderRadius: 12,
  },
  keyboardAvoid: {
    flex: 1,
  },
  loginBtn3d: {
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
    position: "relative",
  },
  loginBtnText: {
    fontFamily: "SofiaProBold",
    fontWeight: "normal",
    letterSpacing: -0.3,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  methodChip: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    height: 40,
    justifyContent: "center",
  },
  passkeyBtn3d: {
    alignItems: "center",
    borderRadius: 9999,
    height: 44,
    justifyContent: "center",
    width: 44,
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
  socialBtn3d: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
});
