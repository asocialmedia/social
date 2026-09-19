// Native 6-slot OTP input. Ports web InputOTP behavior: digits-only,
// auto-submit at 6 digits, error shake handled by the parent screen.

import { useRef } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";

import { INPUT_ERROR_SHADOWS, INPUT_SHADOWS, useAppTheme } from "@/theme";

interface OtpInputProps {
  disabled?: boolean;
  hasError?: boolean;
  onChange: (value: string) => void;
  value: string;
}

const DIGITS_ONLY = /^\d*$/;
const SLOT_COUNT = 6;

export function OtpInput({
  disabled,
  hasError,
  onChange,
  value,
}: OtpInputProps) {
  const { theme } = useAppTheme();
  const inputsRef = useRef<(TextInput | null)[]>([]);

  const digits = [...value].slice(0, SLOT_COUNT);

  const handleSlotChange = (text: string, index: number) => {
    const char = text.replaceAll(/\D/g, "").slice(-1);
    if (text !== "" && char === "" && !DIGITS_ONLY.test(text)) {
      return;
    }
    const next = [...digits];
    while (next.length < SLOT_COUNT) {
      next.push("");
    }
    next[index] = char;
    onChange(next.join("").slice(0, SLOT_COUNT));
    if (char !== "" && index < SLOT_COUNT - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  return (
    <View style={styles.row}>
      {Array.from({ length: SLOT_COUNT }, (_, index) => (
        <View
          key={`otp-slot-${index}`}
          style={[
            styles.slot,
            {
              backgroundColor: hasError
                ? "rgba(255, 123, 99, 0.1)"
                : theme.inputBg,
              boxShadow: hasError ? INPUT_ERROR_SHADOWS : INPUT_SHADOWS,
            },
          ]}
        >
          <TextInput
            autoComplete="one-time-code"
            editable={!disabled}
            inputMode="numeric"
            keyboardType={Platform.OS === "ios" ? "number-pad" : "numeric"}
            maxLength={1}
            onChangeText={(text) => handleSlotChange(text, index)}
            onKeyPress={({ nativeEvent }) =>
              handleKeyPress(nativeEvent.key, index)
            }
            ref={(ref) => {
              inputsRef.current[index] = ref;
            }}
            selectTextOnFocus
            style={[styles.slotText, { color: theme.inputText }]}
            value={digits[index] ?? ""}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between",
    width: "100%",
  },
  slot: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    height: 48,
    justifyContent: "center",
  },
  slotText: {
    fontFamily: "SofiaProBold",
    fontSize: 18,
    fontWeight: "normal",
    textAlign: "center",
    width: "100%",
  },
});
