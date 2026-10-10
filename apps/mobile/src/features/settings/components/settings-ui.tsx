// The settings chrome, ported 1:1 from web's
// `components/settings/settings-section-card.tsx` plus the tab strip, inputs,
// buttons, switch and icon button the account/profile/security tabs share.
//
// Every raised surface uses the same 3D dual-border construction the rest of
// the app uses (hairline outer edge + bright inner lip on a surface one step
// above the page), so the settings cards, subcards and chips read as one
// family with the feed and profile surfaces.
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  btnGray,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
  premiumInput,
  themeText,
} from "@/components/surface/recipes";
import { haptic } from "@/lib/haptics";
import {
  BTN_3D_DANGER_PRESSED_SHADOWS,
  BTN_3D_DANGER_PRESSED_SHADOWS_DARK,
  BTN_3D_DANGER_SHADOWS,
  BTN_3D_DANGER_SHADOWS_DARK,
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  SWITCH_TRACK_SHADOWS,
  SWITCH_TRACK_SHADOWS_LIGHT,
  useAppTheme,
} from "@/theme";

type IconComponent = ComponentType<{ color?: string; size?: number }>;

// Web's `ORANGE_GRADIENT_CLASS`: the brand tile every section and card head
// wears, so one orange appears across the whole screen.
const ORANGE_TILE_GRADIENT = ORANGE_GRADIENT;

// Web's `SettingsSectionHeader`: the orange tile plus title and description.
export function SettingsSectionHeader({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: IconComponent;
  title: string;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  return (
    <View style={styles.sectionHeader}>
      <Gradient3D
        colors={ORANGE_TILE_GRADIENT}
        radius={12}
        shadows={
          isDark
            ? "inset 0 0 0 1px rgba(255,255,255,0.25), inset 0 1.5px 2px rgba(255,255,255,0.5), 0 0 0 1px rgba(170,60,0,0.95), 0 1px 1px rgba(255,255,255,0.4), 0 3px 5px rgba(0,0,0,0.12)"
            : "inset 0 0 0 1px rgba(255,255,255,0.5), inset 0 1.5px 2px rgba(255,255,255,0.65), 0 0 0 1px rgba(230,85,0,0.32), 0 1px 2px rgba(190,75,0,0.24), 0 3px 7px -2px rgba(190,75,0,0.26)"
        }
        style={styles.sectionHeaderTile}
      >
        <Icon color="#ffffff" size={20} />
      </Gradient3D>
      <View style={styles.minWidthZero}>
        <Text style={[styles.sectionHeaderTitle, { color: text.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.sectionHeaderDesc, { color: text.muted }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}

// Web's `SettingsCard`: the raised surface every control group lives in.
export function SettingsCard({
  children,
  padded = true,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: object;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
        },
        padded ? styles.cardPadded : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Web's `SETTINGS_SUBCARD_CLASS`: tonal elevation for a row inside a card.
export function SettingsSubcard({
  children,
  style,
}: {
  children: ReactNode;
  style?: object;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View
      style={[
        styles.subcard,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Web's `SettingsCardHeading`: the smaller orange mark, title and trailing row.
export function SettingsCardHeading({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: IconComponent;
  title: string;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  return (
    <View style={styles.cardHeading}>
      <Gradient3D
        colors={ORANGE_TILE_GRADIENT}
        radius={8}
        shadows={
          isDark
            ? "inset 0 0 0 1px rgba(255,255,255,0.25), inset 0 1.5px 2px rgba(255,255,255,0.5), 0 0 0 1px rgba(170,60,0,0.95), 0 1px 1px rgba(255,255,255,0.4), 0 3px 5px rgba(0,0,0,0.12)"
            : "inset 0 0 0 1px rgba(255,255,255,0.5), inset 0 1.5px 2px rgba(255,255,255,0.65), 0 0 0 1px rgba(230,85,0,0.32), 0 1px 2px rgba(190,75,0,0.24), 0 3px 7px -2px rgba(190,75,0,0.26)"
        }
        style={styles.cardHeadingTile}
      >
        <Icon color="#ffffff" size={14} />
      </Gradient3D>
      <View style={styles.minWidthZero}>
        <Text style={[styles.cardHeadingTitle, { color: text.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.cardHeadingDesc, { color: text.muted }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}

// Web's `SettingsStatusChip`: a tonal state marker. The on state keeps the
// brand orange as a deep light-mode tint / light dark-mode tint so the 12px
// label clears AA; off is a quiet muted step.
export function SettingsStatusChip({
  label,
  on,
}: {
  label: string;
  on: boolean;
}) {
  const { isDark } = useAppTheme();
  return (
    <View
      style={[styles.chip, { backgroundColor: chipBackground(on, isDark) }]}
    >
      <Text style={[styles.chipText, { color: chipText(on, isDark) }]}>
        {label}
      </Text>
    </View>
  );
}

function chipBackground(on: boolean, isDark: boolean): string {
  if (on) {
    return isDark ? "rgba(255, 149, 0, 0.2)" : "rgba(255, 149, 0, 0.12)";
  }
  return isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
}

function chipText(on: boolean, isDark: boolean): string {
  if (!on) {
    return themeText(isDark).muted;
  }
  return isDark ? "#ffbe99" : "#7a2e00";
}

export type SettingsButtonTone = "danger" | "gray" | "primary";

// The 3D pill button: web's `.btn-3d`, `.btn-3d-gray` and `.btn-3d-danger`.
export function SettingsButton({
  block = false,
  disabled,
  label,
  loading,
  onPress,
  size = "md",
  tone = "primary",
}: {
  block?: boolean;
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  size?: "md" | "sm";
  tone?: SettingsButtonTone;
}) {
  const { isDark } = useAppTheme();
  const gated = Boolean(disabled) || Boolean(loading);
  const compact = size === "sm";
  const recipe = buttonTone(tone, isDark);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: gated }}
      disabled={gated}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={[
        block ? styles.buttonBlock : null,
        gated ? styles.buttonGated : null,
      ]}
    >
      {({ pressed }) => (
        <Gradient3D
          colors={pressed && !gated ? recipe.pressedColors : recipe.colors}
          radius={9999}
          shadows={pressed && !gated ? recipe.pressedShadows : recipe.shadows}
          style={[
            styles.button,
            compact ? styles.buttonSm : styles.buttonMd,
            block ? styles.buttonBlockInner : null,
            pressed && !gated ? styles.buttonPressed : null,
          ]}
        >
          <View style={styles.buttonContent}>
            {loading ? (
              <ActivityIndicator color={recipe.textColor} size="small" />
            ) : null}
            <Text style={[styles.buttonText, { color: recipe.textColor }]}>
              {label}
            </Text>
          </View>
        </Gradient3D>
      )}
    </Pressable>
  );
}

interface ButtonToneRecipe {
  colors: readonly [string, string, ...string[]];
  pressedColors: readonly [string, string, ...string[]];
  pressedShadows: string;
  shadows: string;
  textColor: string;
}

function buttonTone(
  tone: SettingsButtonTone,
  isDark: boolean
): ButtonToneRecipe {
  if (tone === "gray") {
    const { pressed, resting } = btnGray(isDark);
    return {
      colors: resting.colors,
      pressedColors: pressed.colors,
      pressedShadows: pressed.shadows,
      shadows: resting.shadows,
      textColor: resting.text,
    };
  }
  if (tone === "danger") {
    return {
      colors: isDark ? ["#5c2626", "#3f1a1a"] : ["#ffe3e3", "#ffcaca"],
      pressedColors: isDark ? ["#6f2e2e", "#4d2020"] : ["#ffd5d5", "#ffb3b3"],
      pressedShadows: isDark
        ? BTN_3D_DANGER_PRESSED_SHADOWS_DARK
        : BTN_3D_DANGER_PRESSED_SHADOWS,
      shadows: isDark ? BTN_3D_DANGER_SHADOWS_DARK : BTN_3D_DANGER_SHADOWS,
      textColor: isDark ? "#ff9d92" : "#b91c1c",
    };
  }
  return {
    colors: ORANGE_GRADIENT,
    pressedColors: ORANGE_PRESSED_GRADIENT,
    pressedShadows: isDark
      ? LOGIN_BUTTON_PRESSED_SHADOWS
      : LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
    shadows: isDark ? LOGIN_BUTTON_SHADOWS : LOGIN_BUTTON_SHADOWS_LIGHT,
    textColor: "#ffffff",
  };
}

// Web's `.icon-btn-3d`, for a compact round action (remove passkey, etc.).
export function SettingsIconButton({
  accessibilityLabel,
  danger = false,
  icon: Icon,
  iconSize = 14,
  onPress,
  size = 32,
}: {
  accessibilityLabel: string;
  danger?: boolean;
  icon: IconComponent;
  iconSize?: number;
  onPress: () => void;
  size?: number;
}) {
  const { isDark, theme } = useAppTheme();
  const bg = isDark ? "#232323" : "#f9f9f9";
  const shadows = isDark
    ? "inset 0 1px 2px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.08), 0 1px 1px rgba(255,255,255,0.04)"
    : "inset 0 1px 1px rgba(255,255,255,0.7), 0 0 0 1px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)";
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        haptic();
        onPress();
      }}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.iconButton,
            {
              backgroundColor: bg,
              boxShadow: shadows,
              height: size,
              width: size,
            },
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Icon
            color={iconButtonColor(danger, isDark, theme.passkeyIcon)}
            size={iconSize}
          />
        </View>
      )}
    </Pressable>
  );
}

function iconButtonColor(
  danger: boolean,
  isDark: boolean,
  muted: string
): string {
  if (!danger) {
    return muted;
  }
  return isDark ? "#ff8a80" : "#b91c1c";
}

// Web's `premium-input`, with an optional leading icon or prefix glyph.
export function SettingsInput({
  autoCapitalize = "none",
  editable = true,
  keyboardType,
  label,
  leading,
  leadingIcon: LeadingIcon,
  leadingText,
  maxLength,
  multiline,
  onChangeText,
  placeholder,
  secureTextEntry,
  value,
}: {
  autoCapitalize?: "none" | "sentences" | "words";
  editable?: boolean;
  keyboardType?: "default" | "email-address" | "numeric";
  label: string;
  leading?: ReactNode;
  leadingIcon?: IconComponent;
  leadingText?: string;
  maxLength?: number;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  value: string;
}) {
  const { isDark, theme } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const field = premiumInput(isDark, focused);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.dividerText }]}>
        {label}
      </Text>
      {/* Android does not paint an inset box-shadow on a TextInput itself, so
          the premium-input recipe rides a wrapper View and the field inside
          stays transparent, exactly like web's `.premium-input` on a div. */}
      <View
        style={[
          styles.inputField3d,
          multiline ? styles.inputFieldMultiline : null,
          {
            backgroundColor: field.background,
            boxShadow: field.shadows,
          },
        ]}
      >
        {leading}
        {LeadingIcon ? (
          <LeadingIcon color={theme.dividerText} size={16} />
        ) : null}
        {leadingText ? (
          <Text style={[styles.inputLeadingText, { color: theme.dividerText }]}>
            {leadingText}
          </Text>
        ) : null}
        <TextInput
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          editable={editable}
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          placeholderTextColor={field.placeholder}
          secureTextEntry={secureTextEntry}
          style={[
            styles.input,
            multiline ? styles.inputMultilineText : null,
            { color: field.text },
          ]}
          value={value}
        />
      </View>
    </View>
  );
}

// Web's `premium-switch`: the tactile toggle used by push settings.
export function SettingsSwitch({
  accessibilityLabel,
  disabled,
  onValueChange,
  value,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onValueChange: (next: boolean) => void;
  value: boolean;
}) {
  const { isDark } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        haptic();
        onValueChange(!value);
      }}
    >
      <View
        style={[
          styles.switchTrack,
          {
            backgroundColor: switchTrackColor(value, isDark),
            boxShadow: isDark
              ? SWITCH_TRACK_SHADOWS
              : SWITCH_TRACK_SHADOWS_LIGHT,
          },
          disabled ? styles.buttonGated : null,
        ]}
      >
        <View
          style={[
            styles.switchThumb,
            {
              backgroundColor: "#ffffff",
              transform: [{ translateX: value ? 16 : 2 }],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

function switchTrackColor(value: boolean, isDark: boolean): string {
  if (value) {
    return "#ff9500";
  }
  return isDark ? "rgba(255,255,255,0.14)" : "#ffffff";
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
  buttonBlock: { alignSelf: "stretch", width: "100%" },
  buttonBlockInner: { width: "100%" },
  buttonContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonGated: { opacity: 0.5 },
  buttonMd: { height: 40, paddingHorizontal: 22 },
  buttonPressed: { transform: [{ translateY: 1 }] },
  buttonSm: { height: 36, paddingHorizontal: 18 },
  buttonText: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
  },
  cardHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  cardHeadingAction: { marginLeft: "auto" },
  cardHeadingDesc: { fontFamily: "SofiaProReg", fontSize: 13 },
  cardHeadingTile: { height: 28, width: 28 },
  cardHeadingTitle: { fontFamily: "SofiaProMed", fontSize: 15 },
  cardPadded: { gap: 12, padding: 20 },
  chip: {
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontFamily: "SofiaProBold", fontSize: 12, fontWeight: "normal" },
  field: { gap: 6 },
  fieldLabel: { fontFamily: "SofiaProMed", fontSize: 13 },
  iconButton: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
  },
  input: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 15,
    minWidth: 0,
    padding: 0,
  },
  inputField3d: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  inputFieldMultiline: { alignItems: "flex-start", minHeight: 88 },
  inputLeadingText: {
    fontFamily: "SofiaProMed",
    fontSize: 15,
  },
  inputMultilineText: { paddingVertical: 0, textAlignVertical: "top" },
  minWidthZero: { flexShrink: 1, minWidth: 0 },
  sectionHeader: { alignItems: "center", flexDirection: "row", gap: 12 },
  sectionHeaderDesc: { fontFamily: "SofiaProReg", fontSize: 13 },
  sectionHeaderTile: { height: 40, width: 40 },
  sectionHeaderTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  subcard: {
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
  },
  switchThumb: {
    borderRadius: 9999,
    boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
    height: 16,
    width: 16,
  },
  switchTrack: {
    borderRadius: 9999,
    height: 20,
    justifyContent: "center",
    width: 36,
  },
});
