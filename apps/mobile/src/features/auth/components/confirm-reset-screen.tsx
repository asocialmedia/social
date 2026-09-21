// 1:1 native port of web ConfirmResetForm (set-new-password screen).
// Reads the reset token from the deep link, verifies it against the web
// route's token check, and submits the new password to the auth service.

import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertCircle, Eye, EyeOff } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import confirmBgImage from "@/assets/images/confirm-reset-image.jpg";
import {
  confirmPasswordReset,
  validateResetToken,
} from "@/features/auth/lib/auth-api";
import { validateNewPassword } from "@/features/auth/lib/auth-validation";
import {
  ERROR_SHADOWS,
  INPUT_FOCUS_SHADOWS,
  INPUT_SHADOWS,
  useAppTheme,
} from "@/theme";

import { AuthPrimaryButton } from "./auth-primary-button";
import { AuthShell } from "./auth-shell";
import { PasswordStrength } from "./password-strength";

export default function ConfirmResetScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [focusedField, setFocusedField] = useState<
    "confirm" | "password" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // null while the token check is in flight, so the form does not flash.
  const [isTokenValid, setIsTokenValid] = useState<boolean | null>(
    token ? null : false
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    let active = true;
    void (async () => {
      const valid = await validateResetToken(token);
      if (active) {
        setIsTokenValid(valid);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  function getFieldShadow(field: "confirm" | "password"): string {
    if (error) {
      return ERROR_SHADOWS;
    }
    if (focusedField === field) {
      return INPUT_FOCUS_SHADOWS;
    }
    return INPUT_SHADOWS;
  }

  const handleSubmit = useCallback(async () => {
    if (!token) {
      setError("This reset link is missing its token. Request a new one.");
      return;
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setError(null);
    setIsLoading(true);
    const result = await confirmPasswordReset(password, token);
    setIsLoading(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't reset your password, try again?");
      return;
    }
    // Only reached once the server accepted the new password.
    router.replace("/(auth)/login");
  }, [confirmPassword, password, router, token]);

  const renderPasswordField = (
    label: string,
    value: string,
    onChange: (text: string) => void,
    field: "confirm" | "password",
    visible: boolean,
    onToggleVisible: () => void,
    placeholder: string
  ) => (
    <View className="mb-3">
      <Text
        className="mb-1.5 text-sm"
        style={{ color: theme.inputLabel, fontFamily: "SofiaProMed" }}
      >
        {label}
      </Text>
      <View
        className="h-10 flex-row items-center rounded-xl px-3.5"
        style={{
          backgroundColor: error ? "rgba(255, 123, 99, 0.1)" : theme.inputBg,
          borderRadius: 12,
          boxShadow: getFieldShadow(field),
        }}
      >
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 p-0 text-sm"
          onBlur={() => setFocusedField(null)}
          onChangeText={(text) => {
            onChange(text);
            if (error) {
              setError(null);
            }
          }}
          onFocus={() => setFocusedField(field)}
          placeholder={placeholder}
          placeholderTextColor={theme.inputPlaceholder}
          secureTextEntry={!visible}
          style={{ color: theme.inputText, fontFamily: "SofiaProReg" }}
          value={value}
        />
        <Pressable hitSlop={8} onPress={onToggleVisible}>
          {visible ? (
            <EyeOff color={theme.eyeIcon} size={16} />
          ) : (
            <Eye color={theme.eyeIcon} size={16} />
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <AuthShell
      backgroundImage={confirmBgImage}
      heading="Set New Password"
      headingColor="#3b82f6"
      onGuestPress={() => router.replace("/")}
    >
      {isTokenValid === false ? (
        <View className="items-center gap-3 py-4">
          <AlertCircle color="#ff7b63" size={22} />
          <Text
            className="text-center text-sm"
            style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
          >
            This reset link is invalid or has expired. Request a new one to
            continue.
          </Text>
          <Pressable
            hitSlop={6}
            onPress={() => router.replace("/(auth)/reset-password")}
          >
            <Text
              className="text-sm"
              style={{ color: theme.auxLink, fontFamily: "SofiaProMed" }}
            >
              Request a new link
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
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
                className="flex-1 text-center text-xs"
                style={{
                  color: theme.errorBannerText,
                  fontFamily: "SofiaProMed",
                }}
              >
                {error}
              </Text>
            </View>
          ) : null}
          {renderPasswordField(
            "New Password",
            password,
            setPassword,
            "password",
            showPassword,
            () => setShowPassword(!showPassword),
            "••••••••"
          )}
          <PasswordStrength password={password} />
          {renderPasswordField(
            "Confirm Password",
            confirmPassword,
            setConfirmPassword,
            "confirm",
            showConfirm,
            () => setShowConfirm(!showConfirm),
            "••••••••"
          )}
          <View className="mt-2">
            <AuthPrimaryButton
              label="Reset Password"
              loading={isLoading}
              onPress={() => {
                void handleSubmit();
              }}
            />
          </View>
        </>
      )}
    </AuthShell>
  );
}
