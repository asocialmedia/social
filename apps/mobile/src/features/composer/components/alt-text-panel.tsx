// Post-mode alt text editor, 1:1 port of web's alt-text-panel.tsx: one
// premium-input bar under the attachment grid holding the description field
// (max 1000 chars), the amber "Auto" button (Zeph mark, "Analyzing..."
// while GET /api/media/:id/alt runs), a dismiss X and the orange "Done".
// Saving PATCHes the media's alt text right away, like web's setAltText.
import { Image } from "expo-image";
import { X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import zephImage from "@/assets/images/zeph.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  ORANGE_GRADIENT,
  premiumInput,
  themeText,
} from "@/components/surface/recipes";
import { suggestAltText } from "@/features/media-upload/lib/upload-api";
import type { DraftAttachment } from "@/features/media-upload/state/attachment-store";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

const AUTO_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.4), 0 0 0 1px rgba(234, 88, 12, 0.6), 0 1px 1px rgba(255, 255, 255, 0.2), 0 2px 4px rgba(0, 0, 0, 0.15)";
const DONE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 2px 4px rgba(0, 0, 0, 0.12)";

export function AltTextPanel({
  attachment,
  onClose,
  onSave,
}: {
  attachment: DraftAttachment;
  onClose: () => void;
  onSave: (altText: string) => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const [draft, setDraft] = useState(attachment.altText);
  const [focused, setFocused] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const input = premiumInput(isDark, focused);

  const runAuto = async () => {
    if (!attachment.mediaId || analyzing) {
      return;
    }
    setAnalyzing(true);
    try {
      const result = await suggestAltText(attachment.mediaId);
      if (result.suggestedAlt) {
        setDraft(result.suggestedAlt.slice(0, 1000));
      }
    } catch (error) {
      logWarn("composer.alt_suggest_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
    setAnalyzing(false);
  };

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: input.background, boxShadow: input.shadows },
      ]}
    >
      <TextInput
        accessibilityLabel="Alt text"
        autoFocus
        maxLength={1000}
        multiline
        onBlur={() => setFocused(false)}
        onChangeText={setDraft}
        onFocus={() => setFocused(true)}
        placeholder="Write a description so everyone can follow along…"
        placeholderTextColor={input.placeholder}
        style={[styles.field, { color: input.text }]}
        value={draft}
      />
      {attachment.mediaId ? (
        <Pressable
          accessibilityLabel="Auto-generate alt text from speech and text detection"
          accessibilityRole="button"
          disabled={analyzing}
          onPress={() => {
            void runAuto();
          }}
          style={({ pressed }) => [
            styles.auto,
            { boxShadow: AUTO_SHADOWS },
            pressed && styles.pressed,
            analyzing && styles.disabled,
          ]}
        >
          {analyzing ? (
            <ActivityIndicator color="#fb923c" size={14} />
          ) : (
            <Image
              accessibilityLabel=""
              contentFit="contain"
              source={zephImage}
              style={styles.zeph}
            />
          )}
          <Text style={styles.autoText}>
            {analyzing ? "Analyzing..." : "Auto"}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel="Dismiss alt text editor"
        accessibilityRole="button"
        hitSlop={4}
        onPress={onClose}
        style={styles.dismiss}
      >
        <X color={text.muted} size={16} />
      </Pressable>
      <Pressable
        accessibilityLabel="Save alt text"
        accessibilityRole="button"
        onPress={() => onSave(draft.trim())}
      >
        {({ pressed }) => (
          <Gradient3D
            colors={ORANGE_GRADIENT}
            shadows={DONE_SHADOWS}
            style={[styles.done, pressed && styles.pressed]}
          >
            <Text style={styles.doneText}>Done</Text>
          </Gradient3D>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  auto: {
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.16)",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
  },
  autoText: {
    color: "#fb923c",
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  bar: {
    alignItems: "center",
    borderRadius: 16,
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  dismiss: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  done: {
    height: 32,
    paddingHorizontal: 16,
  },
  doneText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  field: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    maxHeight: 96,
    minWidth: 0,
    padding: 0,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  zeph: {
    height: 16,
    width: 16,
  },
});
