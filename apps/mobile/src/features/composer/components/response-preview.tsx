// Respond banner, port of web's PostEditorResponsePreview: a muted card
// naming the post being responded to (avatar, name, badge, @handle, Gust
// chip, · date), its text (scrolls past 208px), and a "Replying to
// @username" footer, with an X that turns the composer back into a normal
// post. The attachment strip is summarized as a count chip (web renders
// non-interactive previews there).
import { CornerDownRight, ImageIcon, X } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { themeText } from "@/components/surface/recipes";
import { formatRelativeDate } from "@/features/feed/lib/feed-types";
import { UserBadge } from "@/features/home/components/user-badge";
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
  const attachmentCount = replyTo.attachments?.length ?? 0;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark
            ? "rgba(48, 48, 48, 0.2)"
            : "rgba(232, 232, 232, 0.2)",
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.1)"
            : "rgba(0, 0, 0, 0.08)",
        },
      ]}
    >
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
              <UserBadge badge={replyTo.badge} badges={replyTo.badges} />
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
            <ScrollView nestedScrollEnabled style={styles.contentScroll}>
              <Text style={[styles.content, { color: text.foreground }]}>
                {replyTo.content}
              </Text>
            </ScrollView>
          ) : null}
          {attachmentCount > 0 ? (
            <View style={styles.attachments}>
              <ImageIcon color={text.muted} size={14} />
              <Text style={[styles.meta, { color: text.muted }]}>
                {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}
              </Text>
            </View>
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
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
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
