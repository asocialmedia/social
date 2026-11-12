// Native ports of the small pieces web's network panels are built from:
// `settings-panel-section.tsx` (the section shell with its 36px mark and count
// chip), `settings-pill.tsx` (a chosen item with its remove cross), the
// `chip-3d` tag, and the full-width `pill-3d-hover` row with a `surface-3d`
// tile that the Languages panel uses for its two controls.
import { ChevronRight, X } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_GRADIENT,
  orangeSurfaceShadows,
  pressedPill,
  themeText,
} from "@/components/surface/recipes";
import { SettingsCard } from "@/features/settings/components/settings-ui";
import { SectionAnchor } from "@/features/settings/lib/settings-scroll";
import { haptic } from "@/lib/interaction/haptics";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

export type PanelIcon = ComponentType<{ color?: string; size?: number }>;

// `.chip-3d`: the quiet tag used for counts and learned topics.
export function chip3d(isDark: boolean) {
  return isDark
    ? {
        background: "#262626",
        border: "rgba(255,255,255,0.1)",
        shadows:
          "inset 0 1px 1px rgba(255,255,255,0.05), 0 1px 1px rgba(0,0,0,0.2)",
      }
    : {
        background: "#efefef",
        border: "rgba(0,0,0,0.08)",
        shadows:
          "inset 0 1px 1px rgba(255,255,255,0.7), 0 1px 1px rgba(0,0,0,0.04)",
      };
}

// `.chip-3d-raised`: a chosen item, carried by depth rather than hue.
function chip3dRaised(isDark: boolean) {
  return isDark
    ? {
        colors: ["#3a3a3a", "#2a2a2a"] as const,
        shadows:
          "0 0 0 1px rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1.5px 2px rgba(255,255,255,0.14), inset 0 -1px 2px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.4)",
      }
    : {
        colors: ["#f9f9f9", "#efefef"] as const,
        shadows:
          "0 0 0 1px rgba(0,0,0,0.14), inset 0 0 0 1px rgba(255,255,255,0.7), inset 0 1.5px 2px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.08)",
      };
}

// The 36px orange mark (`orange-3d-surface size-9 rounded-xl`).
export function OrangeMark({
  icon: Icon,
  size = 36,
}: {
  icon: PanelIcon;
  size?: number;
}) {
  const { isDark } = useAppTheme();
  return (
    <Gradient3D
      colors={ORANGE_GRADIENT}
      radius={12}
      shadows={orangeSurfaceShadows(isDark)}
      style={[styles.mark, { height: size, width: size }]}
    >
      <Icon color="#ffffff" size={size >= 40 ? 20 : 16} />
    </Gradient3D>
  );
}

// `chip-3d rounded-full px-2.5 py-1 text-xs font-medium tabular-nums`.
export function CountChip({ label }: { label: string }) {
  const { isDark } = useAppTheme();
  const chip = chip3d(isDark);
  return (
    <View
      style={[
        styles.countChip,
        {
          backgroundColor: chip.background,
          borderColor: chip.border,
          boxShadow: chip.shadows,
        },
      ]}
    >
      <Text style={[styles.countChipText, { color: themeText(isDark).muted }]}>
        {label}
      </Text>
    </View>
  );
}

// `chip-3d rounded-full px-3 py-1 text-sm`: a learned or related topic.
export function TopicTag({ label }: { label: string }) {
  const { isDark } = useAppTheme();
  const chip = chip3d(isDark);
  return (
    <View
      style={[
        styles.topicTag,
        {
          backgroundColor: chip.background,
          borderColor: chip.border,
          boxShadow: chip.shadows,
        },
      ]}
    >
      <Text
        style={[styles.topicTagText, { color: themeText(isDark).foreground }]}
      >
        {label}
      </Text>
    </View>
  );
}

// Web's `SettingsPanelSection`: `surface-3d space-y-4 rounded-2xl p-5`, a
// header inset by 12px so its mark lines up with the rows below, and an
// optional count chip on the right.
export function PanelSection({
  children,
  count,
  description,
  icon,
  id,
  title,
}: {
  children: ReactNode;
  count?: string;
  description: string;
  icon: PanelIcon;
  id: string;
  title: string;
}) {
  return (
    <SectionAnchor id={id} tab="network">
      <SettingsCard style={styles.section}>
        <PanelHeading
          count={count}
          description={description}
          icon={icon}
          title={title}
        />
        {children}
      </SettingsCard>
    </SectionAnchor>
  );
}

export function PanelHeading({
  count,
  description,
  icon,
  title,
}: {
  count?: string;
  description: string;
  icon: PanelIcon;
  title: string;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  return (
    <View style={styles.heading}>
      <OrangeMark icon={icon} />
      <View style={styles.headingCopy}>
        <Text style={[styles.headingTitle, { color: text.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.headingDescription, { color: text.muted }]}>
          {description}
        </Text>
      </View>
      {count ? <CountChip label={count} /> : null}
    </View>
  );
}

// Web's `SettingsPill`. On touch web always shows the cross (`max-md:w-5`).
export function SettingsPill({
  disabled,
  label,
  onRemove,
}: {
  disabled?: boolean;
  label: string;
  onRemove: () => void;
}) {
  const { isDark } = useAppTheme();
  const raised = chip3dRaised(isDark);
  const text = themeText(isDark);
  return (
    <Gradient3D colors={raised.colors} radius={8} shadows={raised.shadows}>
      <View style={styles.pill}>
        <Text style={[styles.pillText, { color: text.foreground }]}>
          {label}
        </Text>
        <Pressable
          accessibilityLabel={`Remove ${label}`}
          accessibilityRole="button"
          disabled={disabled}
          hitSlop={8}
          onPress={() => {
            haptic();
            onRemove();
          }}
          style={[styles.pillRemove, disabled ? styles.disabled : null]}
        >
          <X color={text.foreground} size={14} />
        </Pressable>
      </View>
    </Gradient3D>
  );
}

// A full-width `pill-3d-hover` row: the pressed state paints the same gray 3D
// fill web shows on hover.
export function PressableRow({
  accessibilityLabel,
  children,
  disabled,
  onPress,
  style,
}: {
  accessibilityLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  onPress: () => void;
  style?: object;
}) {
  const { isDark } = useAppTheme();
  const pressed = pressedPill(isDark);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={disabled ? styles.disabled : null}
    >
      {({ pressed: isPressed }) =>
        isPressed ? (
          <Gradient3D
            colors={pressed.gradient}
            radius={12}
            shadows={pressed.shadows}
            style={[styles.row, style]}
          >
            {children}
          </Gradient3D>
        ) : (
          <View style={[styles.row, styles.rowRest, style]}>{children}</View>
        )
      }
    </Pressable>
  );
}

// The `surface-3d size-9 rounded-xl` tile the Languages rows lead with.
export function SurfaceTile({ icon: Icon }: { icon: PanelIcon }) {
  const { isDark, theme } = useAppTheme();
  return (
    <View
      style={[
        styles.surfaceTile,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
        },
      ]}
    >
      <Icon color={themeText(isDark).foreground} size={16} />
    </View>
  );
}

// A Languages-panel row: tile, label over a one-line value, then a trailing
// slot (the count and chevron, or the picker's chevron).
export function SettingRow({
  accessibilityLabel,
  disabled,
  icon,
  label,
  onPress,
  trailing,
  value,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  icon: PanelIcon;
  label: string;
  onPress: () => void;
  trailing?: ReactNode;
  value: string;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  return (
    <PressableRow
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
    >
      <SurfaceTile icon={icon} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, { color: text.foreground }]}>
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.rowValue, { color: text.muted }]}
        >
          {value}
        </Text>
      </View>
      {trailing ?? <ChevronRight color={text.muted} size={16} />}
    </PressableRow>
  );
}

export const panelStyles = StyleSheet.create({
  // `space-y-4 px-3`: the body of a panel section.
  body: { gap: 16, paddingHorizontal: 12 },
  divider: { borderTopWidth: 1, gap: 8, paddingTop: 12 },
  muted: { fontFamily: "SofiaProReg", fontSize: 12, lineHeight: 17 },
  mutedSm: { fontFamily: "SofiaProReg", fontSize: 14, lineHeight: 20 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

const styles = StyleSheet.create({
  countChip: {
    borderRadius: 9999,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countChipText: { fontFamily: "SofiaProMed", fontSize: 12 },
  disabled: { opacity: 0.4 },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
    paddingLeft: 12,
  },
  headingCopy: { flex: 1, minWidth: 0 },
  headingDescription: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
  },
  headingTitle: { fontFamily: "SofiaProMed", fontSize: 16 },
  mark: { alignItems: "center", justifyContent: "center" },
  pill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
  },
  pillRemove: {
    alignItems: "center",
    borderRadius: 6,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  pillText: { fontFamily: "SofiaProMed", fontSize: 14 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: "SofiaProMed", fontSize: 14 },
  rowRest: { borderCurve: "continuous", borderRadius: 12 },
  rowValue: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 1 },
  section: { gap: 16 },
  surfaceTile: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  topicTag: {
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  topicTagText: { fontFamily: "SofiaProReg", fontSize: 14 },
});
