// The skin-tone control in the full emoji picker.
//
// Ported from apps/web/src/components/messages/emoji-skin-tone-picker.tsx: a
// `chip-3d` trigger showing the current tone, opening a popover with all six
// tones in a grid. The tone is not persisted, matching web, which starts each
// picker at Default.
import { REACTION_SKIN_TONES } from "@asm/messages";
import { Check, ChevronDown } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { ViewInstance } from "react-native";

import { chip3d, panel3d } from "@/features/messages/lib/message-recipes";
import { useAppTheme } from "@/theme";

export const TONE_PREVIEWS = ["👋", "👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"] as const;

const PRIMARY = "#f66b15";

export function EmojiSkinTonePicker({
  disabled = false,
  onChange,
  tone,
}: {
  disabled?: boolean;
  onChange: (tone: number) => void;
  tone: number;
}) {
  const { isDark, theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const chip = chip3d(isDark);
  const panel = panel3d(isDark);
  const triggerRef = useRef<ViewInstance>(null);
  const [anchor, setAnchor] = useState<{ right: number; top: number } | null>(
    null
  );
  // `w-76 max-w-[calc(100vw-1rem)]`.
  const panelWidth = Math.min(304, width - 16);
  const open = () => {
    triggerRef.current?.measureInWindow((x, y, triggerWidth, height) => {
      // align="end" sideOffset={8}.
      setAnchor({
        right: Math.max(8, width - (x + triggerWidth)),
        top: y + height + 8,
      });
    });
  };
  const label = REACTION_SKIN_TONES[tone] ?? "Default";
  const foreground = isDark ? "#eeeeee" : "#202020";
  return (
    <>
      <Pressable
        accessibilityLabel={`Emoji skin tone: ${label}`}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: anchor !== null }}
        disabled={disabled}
        onPress={open}
        ref={triggerRef}
        style={[
          styles.trigger,
          {
            backgroundColor: chip.background,
            boxShadow: chip.shadows,
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      >
        <Text style={styles.triggerEmoji}>{TONE_PREVIEWS[tone]}</Text>
        <View
          style={anchor ? { transform: [{ rotate: "180deg" }] } : undefined}
        >
          <ChevronDown color={theme.dividerText} size={12} />
        </View>
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setAnchor(null)}
        statusBarTranslucent
        transparent
        visible={anchor !== null}
      >
        <Pressable
          accessibilityLabel="Close skin tones"
          onPress={() => setAnchor(null)}
          style={StyleSheet.absoluteFill}
        />
        {anchor ? (
          <View
            accessibilityLabel="Emoji skin tone"
            style={[
              styles.panel,
              {
                backgroundColor: panel.background,
                borderColor: panel.border,
                boxShadow: panel.shadows,
                right: anchor.right,
                top: anchor.top,
                width: panelWidth,
              },
            ]}
          >
            <View style={styles.heading}>
              <Text style={[styles.headingText, { color: foreground }]}>
                Skin tone
              </Text>
              <Text style={[styles.headingLabel, { color: theme.dividerText }]}>
                {label}
              </Text>
            </View>
            <View accessibilityLabel="Skin tone choices" style={styles.grid}>
              {REACTION_SKIN_TONES.map((toneLabel, index) => {
                const selected = tone === index;
                return (
                  <Pressable
                    accessibilityLabel={`${toneLabel} skin tone`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={toneLabel}
                    onPress={() => {
                      onChange(index);
                      setAnchor(null);
                    }}
                    style={({ pressed }) => [
                      styles.choice,
                      selected && styles.choiceSelected,
                      !selected &&
                        pressed && {
                          backgroundColor: isDark
                            ? "rgba(38, 38, 38, 0.7)"
                            : "rgba(229, 229, 229, 0.7)",
                        },
                    ]}
                  >
                    <Text style={styles.choiceEmoji}>
                      {TONE_PREVIEWS[index]}
                    </Text>
                    {selected ? (
                      <View style={styles.check}>
                        <Check color="#ffffff" size={10} strokeWidth={3} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // `bg-primary absolute right-0.5 bottom-0.5 size-3.5 rounded-full`.
  check: {
    alignItems: "center",
    backgroundColor: PRIMARY,
    borderRadius: 7,
    bottom: 2,
    height: 14,
    justifyContent: "center",
    position: "absolute",
    right: 2,
    width: 14,
  },
  // `h-12 rounded-xl text-2xl`.
  choice: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    height: 48,
    justifyContent: "center",
    minWidth: 0,
  },
  choiceEmoji: { fontSize: 24 },
  // `bg-primary/10 ring-1 ring-inset ring-primary/50`.
  choiceSelected: {
    backgroundColor: "rgba(246, 107, 21, 0.1)",
    boxShadow: "inset 0 0 0 1px rgba(246, 107, 21, 0.5)",
  },
  grid: { flexDirection: "row", gap: 4 },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  headingLabel: { fontFamily: "SofiaProReg", fontSize: 12 },
  headingText: { fontFamily: "SofiaProMed", fontSize: 12 },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 8,
    position: "absolute",
  },
  // `chip-3d h-11 (coarse pointer) rounded-full px-3 gap-2`.
  trigger: {
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
  },
  triggerEmoji: { fontSize: 20 },
});
