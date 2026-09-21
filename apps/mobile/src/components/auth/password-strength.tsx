// Native port of web PasswordStrengthChecker + PasswordRecommender.
// Same 7 checks, same Weak/Fair/Good/Strong copy, animated bar via
// react-native-reanimated (already a mobile dependency).

import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { withTiming } from "react-native-reanimated";

import { useAppTheme } from "@/theme";

interface Requirement {
  text: string;
  validator: (password: string) => boolean;
}

const REQUIREMENTS: Requirement[] = [
  { text: "At least 8 characters long", validator: (p) => p.length >= 8 },
  {
    text: "Contains at least one uppercase letter",
    validator: (p) => /[A-Z]/.test(p),
  },
  {
    text: "Contains at least one lowercase letter",
    validator: (p) => /[a-z]/.test(p),
  },
  { text: "Contains at least one number", validator: (p) => /\d/.test(p) },
  {
    text: "Contains at least one special character",
    validator: (p) => /[@$!%*?&#]/.test(p),
  },
  {
    text: "No repeated characters (3+ times)",
    validator: (p) => !/(?<char>.)\k<char>{2,}/.test(p),
  },
  {
    text: "No common sequences (123, abc)",
    validator: (p) => !/(?:abc|123|qwe|xyz)/i.test(p),
  },
];

function getStrengthMeta(percent: number): { color: string; label: string } {
  if (percent <= 25) {
    return { color: "#ef4444", label: "Weak" };
  }
  if (percent <= 50) {
    return { color: "#f97316", label: "Fair" };
  }
  if (percent <= 75) {
    return { color: "#eab308", label: "Good" };
  }
  return { color: "#22c55e", label: "Strong" };
}

export function PasswordStrength({ password }: { password: string }) {
  const { theme } = useAppTheme();

  const { missing, percent } = useMemo(() => {
    if (!password) {
      return { missing: [], percent: 0 };
    }
    const matched = REQUIREMENTS.filter((req) =>
      req.validator(password)
    ).length;
    return {
      missing: REQUIREMENTS.filter((req) => !req.validator(password)),
      percent: (matched / REQUIREMENTS.length) * 100,
    };
  }, [password]);

  if (!password) {
    return null;
  }

  const meta = getStrengthMeta(percent);

  return (
    <View style={styles.container}>
      <View style={[styles.track, { backgroundColor: theme.dividerLine }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: meta.color,
              width: withTiming(`${percent}%`, { duration: 300 }),
            },
          ]}
        />
      </View>
      <View style={styles.strengthRow}>
        <Text
          style={[
            styles.muted,
            styles.fontMedium,
            { color: theme.dividerText },
          ]}
        >
          Password Strength:
        </Text>
        <Text style={[styles.fontMedium, { color: meta.color }]}>
          {meta.label}
        </Text>
      </View>
      {missing.length > 0 ? (
        <View style={styles.requirements}>
          <Text
            style={[
              styles.muted,
              styles.fontMedium,
              { color: theme.dividerText },
            ]}
          >
            Password requirements:
          </Text>
          {missing.map((req) => (
            <View key={req.text} style={styles.requirementRow}>
              <View
                style={[styles.dot, { backgroundColor: theme.dividerText }]}
              />
              <Text
                style={[
                  styles.requirementText,
                  styles.fontRegular,
                  { color: theme.dividerText },
                ]}
              >
                {req.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    marginTop: 8,
  },
  dot: {
    borderRadius: 9999,
    height: 4,
    width: 4,
  },
  fill: {
    borderRadius: 9999,
    height: "100%",
  },
  fontMedium: {
    fontFamily: "SofiaProMed",
    fontWeight: "normal",
  },
  fontRegular: {
    fontFamily: "SofiaProReg",
    fontWeight: "normal",
  },
  muted: {
    fontSize: 12,
  },
  requirementRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  requirementText: {
    flex: 1,
    fontSize: 12,
  },
  requirements: {
    gap: 6,
  },
  strengthRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  track: {
    borderRadius: 9999,
    height: 8,
    overflow: "hidden",
    width: "100%",
  },
});
