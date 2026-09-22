// 1:1 native port of the web Support page + SupportForm
// (app/(docs)/support). Same 3-step wizard, same copy, same validation.
// UI-only: submit is simulated and the attach button stays disabled exactly
// like web ("Attach Files (We are working on this feature)").

import { useRouter } from "expo-router";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  GitPullRequest,
  ShieldAlert,
  Upload,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import Animated, { withTiming } from "react-native-reanimated";

import signupBgImage from "@/assets/images/signup-image.jpg";
import { EMAIL_REGEX } from "@/features/auth/lib/auth-validation";
import {
  ERROR_SHADOWS,
  INPUT_ERROR_SHADOWS,
  INPUT_FOCUS_SHADOWS,
  INPUT_SHADOWS,
  SOCIAL_PRESSED_SHADOWS,
  SOCIAL_SHADOWS,
  useAppTheme,
} from "@/theme";

import { AuthPrimaryButton } from "./auth-primary-button";
import { AuthShell } from "./auth-shell";

const SUPPORT_TYPES = [
  { label: "Help Request", value: "help" },
  { label: "Bug Report", value: "bug" },
  { label: "Suggestion", value: "suggestion" },
  { label: "Other", value: "other" },
] as const;

const CATEGORIES = [
  { label: "Account Issues", value: "account" },
  { label: "Technical Problems", value: "technical" },
  { label: "Feature Requests", value: "feature" },
  { label: "Billing Questions", value: "billing" },
  { label: "Security Concerns", value: "security" },
] as const;

const PRIORITIES = [
  { label: "Low Priority", value: "low" },
  { label: "Medium Priority", value: "medium" },
  { label: "High Priority", value: "high" },
  { label: "Critical", value: "critical" },
] as const;

const STEP_NAMES = [
  "Basic Information",
  "Request Details",
  "Additional Information",
] as const;

interface SupportFormData {
  browser: string;
  category: string;
  email: string;
  message: string;
  os: string;
  priority: string;
  subject: string;
  type: string;
}

const INITIAL_FORM_DATA: SupportFormData = {
  browser: "Expo app",
  category: "",
  email: "",
  message: "",
  os: Platform.OS,
  priority: "medium",
  subject: "",
  type: "",
};

function NativeSelect({
  onValueChange,
  options,
  placeholder,
  value,
}: {
  onValueChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  placeholder: string;
  value: string;
}) {
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View>
      <Pressable
        onPress={() => setOpen(!open)}
        style={[
          {
            alignItems: "center",
            backgroundColor: theme.inputBg,
            borderRadius: 12,
            boxShadow: INPUT_SHADOWS,
            flexDirection: "row",
            height: 40,
            justifyContent: "space-between",
            paddingHorizontal: 14,
          },
        ]}
      >
        <Text
          style={{
            color: selected ? theme.inputText : theme.inputPlaceholder,
            flex: 1,
            fontFamily: "SofiaProReg",
            fontSize: 14,
          }}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <ChevronDown color={theme.eyeIcon} size={16} />
      </Pressable>
      {open ? (
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderColor: theme.cardBorder,
            borderRadius: 12,
            borderWidth: 1,
            boxShadow: SOCIAL_SHADOWS,
            gap: 2,
            marginTop: 6,
            padding: 6,
          }}
        >
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                style={{
                  backgroundColor: isActive
                    ? "rgba(255, 149, 0, 0.15)"
                    : "transparent",
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                }}
              >
                <Text
                  style={{
                    color: isActive ? "#ff9500" : theme.inputLabel,
                    fontFamily: "SofiaProMed",
                    fontSize: 14,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export default function HelpScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<SupportFormData>(INITIAL_FORM_DATA);
  const [emailTouched, setEmailTouched] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    text: string;
    title: string;
  } | null>(null);

  const emailValid = EMAIL_REGEX.test(formData.email);
  const showEmailError = emailTouched && !emailValid;

  const setField = useCallback(
    (field: keyof SupportFormData, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleContinueFromStepOne = useCallback(() => {
    setEmailTouched(true);
    if (EMAIL_REGEX.test(formData.email) && formData.type) {
      setNotice(null);
      setStep(2);
    }
  }, [formData.email, formData.type]);

  const handleSubmit = useCallback(() => {
    if (!formData.message.trim()) {
      setNotice({
        kind: "error",
        text: "Add a message so we know how to help before sending.",
        title: "Message required",
      });
      return;
    }
    // There is no support backend to post to yet: /api/support and
    // /api/support/upload return 404 (the web form hits the same dead ends).
    // Rather than fake a "Message Sent" success and silently drop the report -
    // which could be an account or security issue - say plainly that it was not
    // sent and keep the entered data so nothing is lost.
    setNotice({
      kind: "error",
      text: "In-app support isn't connected yet, so this wasn't sent. Email hello@asocialmedia.cc and we'll pick it up from there - your message is still in the form.",
      title: "Not sent",
    });
  }, [formData.message]);

  const inputShadow = (name: string, hasError: boolean) => {
    if (hasError) {
      return INPUT_ERROR_SHADOWS;
    }
    return focusedField === name ? INPUT_FOCUS_SHADOWS : INPUT_SHADOWS;
  };

  return (
    <AuthShell
      backgroundImage={signupBgImage}
      heading="How can we help?"
      onGuestPress={() => router.replace("/")}
    >
      <Text
        className="mb-4 text-center text-sm"
        style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
      >
        We&apos;re here to help! Send us your questions, suggestions, or report
        any issues.
      </Text>

      {notice ? (
        <View
          className="mb-3 flex-row items-center justify-center gap-2 rounded-xl px-3 py-2"
          style={{
            backgroundColor: theme.errorBannerBg,
            boxShadow: ERROR_SHADOWS,
          }}
        >
          {notice.kind === "success" ? (
            <Check color="#22c55e" size={15} />
          ) : (
            <AlertCircle color="#ff7b63" size={15} />
          )}
          <View className="flex-1">
            <Text
              className="text-center text-xs"
              style={{
                color: theme.errorBannerText,
                fontFamily: "SofiaProMed",
              }}
            >
              {notice.title}
            </Text>
            <Text
              className="text-center text-xs"
              style={{
                color: theme.errorBannerText,
                fontFamily: "SofiaProReg",
              }}
            >
              {notice.text}
            </Text>
          </View>
        </View>
      ) : null}

      {/* StepIndicator */}
      <View className="mb-4 flex-row items-center justify-between">
        <Text
          className="text-sm text-[#ff9500]"
          style={{ fontFamily: "SofiaProMed" }}
        >
          Step {step}/3
        </Text>
        <Text
          className="text-sm"
          style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
        >
          {STEP_NAMES[step - 1]}
        </Text>
      </View>

      {step === 1 ? (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text
              className="text-lg"
              style={{ color: theme.inputLabel, fontFamily: "SofiaProBold" }}
            >
              Basic Information
            </Text>
            <Text
              className="text-sm"
              style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
            >
              Let&apos;s start with your contact information
            </Text>
          </View>
          <View style={{ gap: 16 }}>
            <View style={{ gap: 6 }}>
              <View
                className="h-10 flex-row items-center rounded-xl px-3.5"
                style={[
                  {
                    backgroundColor: showEmailError
                      ? "rgba(255, 123, 99, 0.1)"
                      : theme.inputBg,
                  },
                  { boxShadow: inputShadow("email", showEmailError) },
                ]}
              >
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 p-0 text-sm"
                  keyboardType="email-address"
                  onBlur={() => {
                    setFocusedField(null);
                    setEmailTouched(true);
                  }}
                  onChangeText={(text) => setField("email", text)}
                  onFocus={() => setFocusedField("email")}
                  placeholder="Your email address"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={{ color: theme.inputText, fontFamily: "SofiaProReg" }}
                  value={formData.email}
                />
              </View>
              {showEmailError ? (
                <View className="flex-row items-center gap-1.5">
                  <AlertCircle color="#ff7b63" size={14} />
                  <Text
                    className="text-xs"
                    style={{ color: "#ff7b63", fontFamily: "SofiaProReg" }}
                  >
                    Please enter a valid email address
                  </Text>
                </View>
              ) : null}
            </View>
            <NativeSelect
              onValueChange={(value) => setField("type", value)}
              options={SUPPORT_TYPES}
              placeholder="Type of support needed"
              value={formData.type}
            />
            <AuthPrimaryButton
              label="Continue"
              onPress={handleContinueFromStepOne}
            />
          </View>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text
              className="text-lg"
              style={{ color: theme.inputLabel, fontFamily: "SofiaProBold" }}
            >
              Request Details
            </Text>
            <Text
              className="text-sm"
              style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
            >
              Help us understand your request better
            </Text>
          </View>
          <View style={{ gap: 16 }}>
            <NativeSelect
              onValueChange={(value) => setField("category", value)}
              options={CATEGORIES}
              placeholder="Select category"
              value={formData.category}
            />
            <NativeSelect
              onValueChange={(value) => setField("priority", value)}
              options={PRIORITIES}
              placeholder="Select priority"
              value={formData.priority}
            />
            <View
              className="h-10 flex-row items-center rounded-xl px-3.5"
              style={[
                { backgroundColor: theme.inputBg },
                { boxShadow: inputShadow("subject", false) },
              ]}
            >
              <TextInput
                className="flex-1 p-0 text-sm"
                onBlur={() => setFocusedField(null)}
                onChangeText={(text) => setField("subject", text)}
                onFocus={() => setFocusedField("subject")}
                placeholder="Subject"
                placeholderTextColor={theme.inputPlaceholder}
                style={{ color: theme.inputText, fontFamily: "SofiaProReg" }}
                value={formData.subject}
              />
            </View>
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setStep(1)}
                style={{ justifyContent: "center" }}
              >
                {({ pressed }) => (
                  <View
                    style={{
                      alignItems: "center",
                      backgroundColor: pressed
                        ? theme.socialBtnPressedBg
                        : theme.socialBtnBg,
                      borderRadius: 12,
                      boxShadow: pressed
                        ? SOCIAL_PRESSED_SHADOWS
                        : SOCIAL_SHADOWS,
                      height: 36,
                      justifyContent: "center",
                      paddingHorizontal: 16,
                    }}
                  >
                    <Text
                      className="text-sm"
                      style={{
                        color: theme.socialBtnText,
                        fontFamily: "SofiaProMed",
                      }}
                    >
                      Back
                    </Text>
                  </View>
                )}
              </Pressable>
              <View className="flex-1">
                <AuthPrimaryButton
                  label="Continue"
                  onPress={() => setStep(3)}
                />
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text
              className="text-lg"
              style={{ color: theme.inputLabel, fontFamily: "SofiaProBold" }}
            >
              Additional Information
            </Text>
            <Text
              className="text-sm"
              style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
            >
              Provide more details and any relevant files
            </Text>
          </View>
          <View style={{ gap: 16 }}>
            <View
              className="rounded-xl px-3.5 py-3"
              style={[
                { backgroundColor: theme.inputBg },
                { boxShadow: inputShadow("message", false) },
              ]}
            >
              <TextInput
                className="text-sm"
                multiline
                numberOfLines={8}
                onBlur={() => setFocusedField(null)}
                onChangeText={(text) => setField("message", text)}
                onFocus={() => setFocusedField("message")}
                placeholder="Describe your issue or suggestion in detail..."
                placeholderTextColor={theme.inputPlaceholder}
                style={{
                  color: theme.inputText,
                  fontFamily: "SofiaProReg",
                  minHeight: 200,
                  textAlignVertical: "top",
                }}
                value={formData.message}
              />
            </View>
            <View
              style={{
                alignItems: "center",
                backgroundColor: theme.socialBtnBg,
                borderRadius: 12,
                boxShadow: SOCIAL_SHADOWS,
                flexDirection: "row",
                gap: 8,
                height: 44,
                justifyContent: "center",
                opacity: 0.6,
                width: "100%",
              }}
            >
              <Upload color={theme.socialBtnText} size={16} />
              <Text
                className="text-sm"
                style={{
                  color: theme.socialBtnText,
                  fontFamily: "SofiaProMed",
                }}
              >
                Attach Files (We are working on this feature)
              </Text>
            </View>
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setStep(2)}
                style={{ justifyContent: "center" }}
              >
                {({ pressed }) => (
                  <View
                    style={{
                      alignItems: "center",
                      backgroundColor: pressed
                        ? theme.socialBtnPressedBg
                        : theme.socialBtnBg,
                      borderRadius: 12,
                      boxShadow: pressed
                        ? SOCIAL_PRESSED_SHADOWS
                        : SOCIAL_SHADOWS,
                      height: 36,
                      justifyContent: "center",
                      paddingHorizontal: 16,
                    }}
                  >
                    <Text
                      className="text-sm"
                      style={{
                        color: theme.socialBtnText,
                        fontFamily: "SofiaProMed",
                      }}
                    >
                      Back
                    </Text>
                  </View>
                )}
              </Pressable>
              <View className="flex-1">
                <AuthPrimaryButton
                  label="Send Message"
                  onPress={handleSubmit}
                />
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {/* Progress bar */}
      <View
        className="mt-5 h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: theme.dividerLine }}
      >
        <Animated.View
          style={[
            {
              backgroundColor: "#ff9500",
              borderRadius: 9999,
              height: "100%",
              width: withTiming(`${(step / 3) * 100}%`, { duration: 300 }),
            },
          ]}
        />
      </View>

      {/* Info cards (web left panel) */}
      <View className="mt-4" style={{ gap: 8 }}>
        <View
          className="rounded-xl p-4"
          style={{ backgroundColor: theme.inputBg, boxShadow: SOCIAL_SHADOWS }}
        >
          <View className="mb-1 flex-row items-center gap-2">
            <GitPullRequest color="#ff9500" size={16} />
            <Text
              className="text-sm"
              style={{ color: "#ff9500", fontFamily: "SofiaProMed" }}
            >
              Open Source Project
            </Text>
          </View>
          <Text
            className="text-xs"
            style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
          >
            asocialmedia is a Free and Open Source Software (FOSS) project. We
            welcome contributions and suggestions to improve our platform. Visit
            our GitHub repository to contribute or provide feedback on our
            policies and documentation.
          </Text>
        </View>
        <View
          className="rounded-xl p-4"
          style={{ backgroundColor: theme.inputBg, boxShadow: SOCIAL_SHADOWS }}
        >
          <View className="mb-1 flex-row items-center gap-2">
            <ShieldAlert color="#ff9500" size={16} />
            <Text
              className="text-sm"
              style={{ color: "#ff9500", fontFamily: "SofiaProMed" }}
            >
              Privacy Notice
            </Text>
          </View>
          <Text
            className="text-xs"
            style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
          >
            To prevent abuse and ensure service quality, we collect and store
            certain information including browser details and submission
            timestamps. This data is used solely for rate limiting and system
            improvements.
          </Text>
        </View>
      </View>

      <View className="mt-4 items-center">
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
    </AuthShell>
  );
}
