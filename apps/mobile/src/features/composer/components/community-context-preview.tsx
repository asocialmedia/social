import { X } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { panel3d, themeText } from "@/components/surface/recipes";
import { resolveCommunityAccentColor } from "@/features/communities/lib/community-accents";
import { useAppTheme } from "@/theme";

import type { ComposerDraft } from "../state/composer-store";

export function CommunityContextPreview({
  draft,
  onClear,
}: {
  draft: ComposerDraft;
  onClear: () => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const panel = panel3d(isDark);
  const share = draft.communityShare;
  const slug = share?.slug ?? draft.communitySlug;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: panel.background,
          borderColor: panel.border,
          boxShadow: panel.shadows,
        },
      ]}
    >
      <View
        style={[
          styles.mark,
          {
            backgroundColor: resolveCommunityAccentColor(
              share?.accentColor,
              isDark
            ),
          },
        ]}
      />
      <Text style={[styles.label, { color: text.muted }]}>
        {share ? "Sharing from " : "Posting in "}
        <Text style={{ color: text.foreground, fontFamily: "SofiaProMed" }}>
          {slug ? `a/${slug}` : "this community"}
        </Text>
        {share ? " to your feed" : ""}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          share ? "Remove community share" : "Post to the global feed instead"
        }
        onPress={onClear}
        style={styles.remove}
      >
        <X color={text.muted} size={16} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
    padding: 10,
  },
  label: { flex: 1, fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  mark: { borderRadius: 9999, height: 16, width: 2 },
  remove: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
});
