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
    const numeric = text.replaceAll(/\D/g, "");
    if (text !== "" && numeric === "") {
      // Purely non-numeric input contributes nothing.
      return;
    }
    const next = [...digits];
    while (next.length < SLOT_COUNT) {
      next.push("");
    }

    if (numeric.length <= 1) {
      // Manual entry replaces only the slot being edited.
      next[index] = numeric;
      onChange(next.join("").slice(0, SLOT_COUNT));
      if (numeric !== "" && index < SLOT_COUNT - 1) {
        inputsRef.current[index + 1]?.focus();
      }
      return;
    }

    // Paste or OS one-time-code autofill delivers the whole code to whichever
    // slot has focus, so spread the digits forward from there instead of
    // discarding all but one.
    for (let offset = 0; offset < numeric.length; offset += 1) {
      const slot = index + offset;
      if (slot >= SLOT_COUNT) {
        break;
      }
      next[slot] = numeric[offset] ?? "";
    }
    onChange(next.join("").slice(0, SLOT_COUNT));
    const lastFilled = Math.min(index + numeric.length, SLOT_COUNT - 1);
    inputsRef.current[lastFilled]?.focus();
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
            maxLength={SLOT_COUNT}
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
