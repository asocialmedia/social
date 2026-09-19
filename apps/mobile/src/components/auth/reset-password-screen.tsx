// 1:1 native port of web ResetPasswordForm. UI-only: validates the
// identifier, then swaps to the "Check Your Email" success panel.

import { useRouter } from "expo-router";
import { ArrowLeft, Mail, XCircle } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import resetBgImage from "@/assets/images/password-reset-image.jpg";
import { requestPasswordReset } from "@/lib/auth-api";
import { validateIdentifier } from "@/lib/auth-validation";
import { INPUT_FOCUS_SHADOWS, INPUT_SHADOWS, useAppTheme } from "@/theme";

import { AuthPrimaryButton } from "./auth-primary-button";
import { AuthShell } from "./auth-shell";

export default function ResetPasswordScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);

  function getFieldShadow(): string {
    if (error) {
      return "inset 0 2px 4px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 123, 99, 0.55)";
    }
    if (isFocused) {
      return INPUT_FOCUS_SHADOWS;
    }
    return INPUT_SHADOWS;
  }

  const handleSubmit = useCallback(async () => {
    const validationError = validateIdentifier(identifier);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setIsLoading(true);
    const result = await requestPasswordReset(identifier.trim());
    setIsLoading(false);
    if (result.ok) {
      setIsEmailSent(true);
      return;
    }
    setError(result.error ?? "Couldn't send the reset email, try again?");
  }, [identifier]);

  return (
    <AuthShell
      backgroundImage={resetBgImage}
      heading="Reset Password"
      onGuestPress={() => router.replace("/")}
    >
      {isEmailSent ? (
        <View className="items-center gap-2 py-2">
          <Text
            className="text-xl"
            style={{ color: theme.inputLabel, fontFamily: "SofiaProBold" }}
          >
            Check Your Email
          </Text>
          <Text
            className="text-center text-sm"
            style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
          >
            If an account exists with that username or email, you&apos;ll
            receive password reset instructions.
          </Text>
          {isLoading ? (
            <ActivityIndicator color="#ff9500" size="small" />
          ) : null}
          <Pressable
            className="mt-4 flex-row items-center gap-2"
            hitSlop={6}
            onPress={() => router.push("/(auth)/login")}
          >
            <ArrowLeft color={theme.auxLink} size={15} />
            <Text
              className="text-sm"
              style={{ color: theme.auxLink, fontFamily: "SofiaProMed" }}
            >
              Back to login
            </Text>
          </Pressable>
        </View>
      ) : (
        <View>
          {error ? (
            <View className="mb-3 flex-row items-center justify-center gap-2">
              <XCircle color="#ff7b63" size={15} />
              <Text
                className="flex-1 text-xs"
                style={{ color: "#ff7b63", fontFamily: "SofiaProMed" }}
              >
                {error}
              </Text>
            </View>
          ) : null}
          <Text
            className="mb-1.5 text-sm"
            style={{ color: theme.inputLabel, fontFamily: "SofiaProMed" }}
          >
            Username or Email
          </Text>
          <View
            className="h-10 flex-row items-center rounded-xl px-3.5"
            style={{
              backgroundColor: error
                ? "rgba(255, 123, 99, 0.1)"
                : theme.inputBg,
              borderRadius: 12,
              boxShadow: getFieldShadow(),
            }}
          >
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 p-0 text-sm"
              onBlur={() => setIsFocused(false)}
              onChangeText={(text) => {
                setIdentifier(text);
                if (error) {
                  setError(null);
                }
              }}
              onFocus={() => setIsFocused(true)}
              placeholder="Enter your username or email"
              placeholderTextColor={theme.inputPlaceholder}
              style={{ color: theme.inputText, fontFamily: "SofiaProReg" }}
              value={identifier}
            />
            <Mail color={theme.eyeIcon} size={16} />
          </View>
          <View className="mt-4">
            <AuthPrimaryButton
              label="Send Reset Link"
              loading={isLoading}
              onPress={() => {
                void handleSubmit();
              }}
            />
          </View>
          <View className="mt-6 items-center">
            <Pressable
              className="flex-row items-center gap-2"
              hitSlop={6}
              onPress={() => router.push("/(auth)/login")}
            >
              <ArrowLeft color={theme.auxLink} size={15} />
              <Text
                className="text-sm"
                style={{ color: theme.auxLink, fontFamily: "SofiaProMed" }}
              >
                Back to login
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </AuthShell>
  );
}
