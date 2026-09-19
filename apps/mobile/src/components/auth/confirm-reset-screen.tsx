// 1:1 native port of web ConfirmResetForm (set-new-password screen).
// UI-only: validates the token state locally, validates both password
// fields against the shared rules, then routes back to login.

import { useRouter } from "expo-router";
import { AlertCircle, Eye, EyeOff } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import confirmBgImage from "@/assets/images/confirm-reset-image.jpg";
import { validateNewPassword } from "@/lib/auth-validation";
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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [focusedField, setFocusedField] = useState<
    "confirm" | "password" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function getFieldShadow(field: "confirm" | "password"): string {
    if (error) {
      return ERROR_SHADOWS;
    }
    if (focusedField === field) {
      return INPUT_FOCUS_SHADOWS;
    }
    return INPUT_SHADOWS;
  }

  const handleSubmit = useCallback(() => {
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
    // UI-only: simulate resetPassword, then go back to login.
    setTimeout(() => {
      setIsLoading(false);
      router.replace("/(auth)/login");
    }, 900);
  }, [confirmPassword, password, router]);

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
            style={{ color: theme.errorBannerText, fontFamily: "SofiaProMed" }}
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
          onPress={handleSubmit}
        />
      </View>
    </AuthShell>
  );
}
