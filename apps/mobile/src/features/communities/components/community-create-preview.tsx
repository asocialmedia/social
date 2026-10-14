import { getCommunityTopic } from "@asm/db/communities";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Flame, LayoutGrid, Users } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { getDefaultAvatar } from "@/features/home/components/profile-utils";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import { resolveCommunityAccentColor } from "../lib/community-accents";
import type { CommunityWizardDraft } from "../lib/community-wizard";
import { wizardSlug } from "../lib/community-wizard";
import { CommunityAvatar } from "./community-avatar";

export function CommunityCreatePreview({
  draft,
  avatarPreview,
  bannerPreview,
  mediaHeaders,
}: {
  draft: CommunityWizardDraft;
  avatarPreview: string | null;
  bannerPreview: string | null;
  mediaHeaders?: Record<string, string>;
}) {
  const { theme, isDark } = useAppTheme();
  const accent = resolveCommunityAccentColor(draft.accentColor, isDark);
  const name = draft.name.trim() || "Your community";
  const slug = wizardSlug(draft).trim() || "address";
  const avatarSource = avatarPreview ?? getDefaultAvatar(slug);
  return (
    <View style={styles.root}>
      <View
        accessibilityLabel="Community preview"
        style={[
          styles.card,
          {
            backgroundColor: theme.backgroundAlt,
            borderColor: theme.cardBorder,
            boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
          },
        ]}
      >
        <View style={[styles.banner, { backgroundColor: `${accent}33` }]}>
          {bannerPreview ? (
            <Image
              source={{ headers: mediaHeaders, uri: bannerPreview }}
              contentFit="cover"
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <LinearGradient
            colors={["transparent", theme.backgroundAlt]}
            style={styles.fade}
          />
          {draft.mature ? (
            <View
              style={[styles.mature, { backgroundColor: theme.backgroundAlt }]}
            >
              <Text style={[styles.hint, { color: theme.inputText }]}>18+</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.body}>
          <View style={styles.avatar}>
            <CommunityAvatar
              key={avatarSource}
              imageHeaders={avatarPreview ? mediaHeaders : undefined}
              community={{
                accentColor: draft.accentColor,
                avatarUrl: avatarSource,
                name,
                slug,
              }}
              size={56}
            />
          </View>
          <Text
            numberOfLines={1}
            style={[styles.name, { color: theme.inputText }]}
          >
            {name}
          </Text>
          <Text style={[styles.hint, { color: theme.dividerText }]}>
            a/{slug}
          </Text>
          <Text
            numberOfLines={3}
            style={[styles.description, { color: theme.dividerText }]}
          >
            {draft.description.trim() ||
              "Describe what this community is about so people know what to expect."}
          </Text>
          {draft.topics.length ? (
            <View style={styles.topics}>
              {draft.topics.map((topic) => (
                <View
                  key={topic}
                  style={[styles.topic, { backgroundColor: theme.containerBg }]}
                >
                  <Text style={[styles.hint, { color: theme.dividerText }]}>
                    {getCommunityTopic(topic)?.label ?? topic}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={[styles.stats, { borderTopColor: theme.cardBorder }]}>
            {[
              { icon: Flame, value: "0" },
              { icon: Users, value: "1" },
              { icon: LayoutGrid, value: "0" },
            ].map(({ icon: Icon, value }, index) => (
              <View key={index} style={styles.stat}>
                <Icon color="#f97316" size={14} />
                <Text style={[styles.statValue, { color: theme.inputText }]}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      <Text style={[styles.hint, { color: theme.dividerText }]}>
        1 weekly visitor · 1 weekly contributor
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  avatar: { marginBottom: 10, marginTop: -32, zIndex: 1 },
  banner: { height: 96 },
  body: { paddingBottom: 14, paddingHorizontal: 14 },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    minHeight: 40,
  },
  fade: { bottom: 0, height: 56, left: 0, position: "absolute", right: 0 },
  hint: { fontFamily: "SofiaProReg", fontSize: 11 },
  mature: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: "absolute",
    right: 10,
    top: 10,
  },
  name: { fontFamily: "SofiaProBold", fontSize: 16 },
  root: { gap: 12 },
  stat: { alignItems: "center", flexDirection: "row", gap: 6 },
  statValue: { fontFamily: "SofiaProMed", fontSize: 12 },
  stats: {
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
    paddingTop: 10,
  },
  topic: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  topics: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 10 },
});
