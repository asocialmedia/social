import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Fingerprint,
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
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSocial, setActiveSocial] = useState<
    "google" | "reddit" | "passkey" | null
  >(null);

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

  const handleLogin = useCallback(() => {
    if (!username.trim() || !password.trim()) {
      setError("Invalid username/email or password");
      triggerShake();
      return;
    }

    setError(null);
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
    }, 1200);
  }, [username, password, triggerShake]);

  const handleSocialClick = useCallback(
    (provider: "google" | "reddit" | "passkey") => {
      setActiveSocial(provider);
      setTimeout(() => {
        setActiveSocial(null);
      }, 1000);
    },
    []
  );

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
                    onPress={() => handleSocialClick("google")}
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
                    onPress={() => handleSocialClick("reddit")}
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
                      style={[styles.fontRegular, { color: theme.inputText }]}
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
                      style={[styles.fontRegular, { color: theme.inputText }]}
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
                    onPress={handleLogin}
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
                            <ActivityIndicator color="#ffffff" size="small" />
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
                    onPress={() => handleSocialClick("passkey")}
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
                          <Fingerprint color={theme.passkeyIcon} size={20} />
                        )}
                      </View>
                    )}
                  </Pressable>
                </View>

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
