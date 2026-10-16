// Respond banner, port of web's PostEditorResponsePreview: a muted card
// naming the post being responded to (avatar, name, badge, @handle, Gust
// chip, · date), its text (scrolls past 208px), and a "Replying to
// @username" footer, with an X that turns the composer back into a normal
// post. Quoted media stays non-interactive, and source links keep their preview cards.
import { CornerDownRight, X } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { panel3d, themeText } from "@/components/surface/recipes";
import { CommunityAttribution } from "@/features/feed/components/community-attribution";
import {
  HNStoryCard,
  CommunityShareCard,
} from "@/features/feed/components/post-embeds";
import { PostLinkEmbeds } from "@/features/feed/components/post-link-embeds";
import { MediaGallery } from "@/features/feed/components/post-media";
import { formatRelativeDate } from "@/features/feed/lib/feed-types";
import { parseStoredEmbeds } from "@/features/feed/lib/link-embeds";
import { BioContent } from "@/features/home/components/bio-content";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import type { ReplyTarget } from "../state/composer-store";

export function ResponsePreview({
  onClear,
  replyTo,
}: {
  onClear: () => void;
  replyTo: ReplyTarget;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const panel = panel3d(isDark);
  const attachments = replyTo.attachments ?? [];
  const embeds = parseStoredEmbeds(replyTo.embeds);
  const apiBase = getApiBaseUrl();
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
      {replyTo.community ? (
        <CommunityAttribution
          slug={replyTo.community.slug}
          accentColor={replyTo.community.accentColor}
          reason={false}
        />
      ) : null}
      <View style={styles.top}>
        <UserAvatar radius={12} size={36} url={replyTo.avatarUrl} />
        <View style={styles.body}>
          <View style={styles.headRow}>
            <View style={styles.head}>
              <Text
                numberOfLines={1}
                style={[styles.name, { color: text.foreground }]}
              >
                {replyTo.displayName || replyTo.username}
              </Text>
              <UserBadge
                badge={replyTo.badge}
                badges={replyTo.badges}
                communityRoles={replyTo.communityMemberships}
              />
              <Text
                numberOfLines={1}
                style={[styles.meta, styles.shrink, { color: text.muted }]}
              >
                @{replyTo.username}
              </Text>
              {replyTo.isGust ? (
                <Text
                  style={[
                    styles.gustChip,
                    {
                      backgroundColor: isDark ? "#303030" : "#e8e8e8",
                      color: text.muted,
                    },
                  ]}
                >
                  Gust
                </Text>
              ) : null}
              <Text style={[styles.meta, { color: text.muted }]}>·</Text>
              <Text style={[styles.meta, { color: text.muted }]}>
                {formatRelativeDate(replyTo.createdAt)}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Cancel response"
              accessibilityRole="button"
              hitSlop={6}
              onPress={onClear}
              style={styles.clear}
            >
              <X color={text.muted} size={16} />
            </Pressable>
          </View>
          {replyTo.content ? (
            <ScrollView
              nestedScrollEnabled
              style={styles.contentScroll}
              showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
            >
              <BioContent apiBase={apiBase} bio={replyTo.content} />
            </ScrollView>
          ) : null}
          {attachments.length > 0 ? (
            <View pointerEvents="none" style={styles.attachments}>
              <MediaGallery
                active={false}
                apiBase={apiBase}
                attachments={attachments}
                postId={replyTo.id}
              />
            </View>
          ) : null}
          {replyTo.hnStoryShare ? (
            <HNStoryCard post={{ hnStoryShare: replyTo.hnStoryShare }} />
          ) : null}
          {replyTo.communityShare ? (
            <CommunityShareCard
              post={{
                community: replyTo.community,
                communityShare: replyTo.communityShare,
              }}
            />
          ) : null}
          {embeds.length > 0 ? (
            <PostLinkEmbeds apiBase={apiBase} embeds={embeds} />
          ) : null}
        </View>
      </View>
      <View
        style={[
          styles.footer,
          {
            borderTopColor: isDark
              ? "rgba(255, 255, 255, 0.06)"
              : "rgba(0, 0, 0, 0.06)",
          },
        ]}
      >
        <CornerDownRight color="#f66b15" size={14} />
        <Text style={[styles.footerText, { color: text.muted }]}>
          Replying to
        </Text>
        <Text numberOfLines={1} style={styles.footerHandle}>
          @{replyTo.username}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  attachments: {
    borderRadius: 12,
    marginTop: 10,
    overflow: "hidden",
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  clear: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    marginRight: -4,
    marginTop: -4,
    width: 28,
  },
  content: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 22,
  },
  contentScroll: {
    marginTop: 6,
    maxHeight: 208,
  },
  footer: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
  },
  footerHandle: {
    color: "#f66b15",
    flexShrink: 1,
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  footerText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  gustChip: {
    borderRadius: 9999,
    fontFamily: "SofiaProBold",
    fontSize: 10,
    overflow: "hidden",
    paddingHorizontal: 6,
  },
  head: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    minWidth: 0,
  },
  headRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  meta: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  name: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  shrink: {
    flexShrink: 1,
  },
  top: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
});
