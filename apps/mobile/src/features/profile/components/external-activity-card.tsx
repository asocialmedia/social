import { useRouter } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BlueskyPostCard } from "@/features/feed/components/bluesky-post-card";
import { formatRelativeDate } from "@/features/feed/lib/feed-types";
import { BioContent } from "@/features/home/components/bio-content";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import type { ExternalProfileActivityItem } from "../lib/profile-activity-schema";

// Port of web's profile ExternalActivityCard: a Bluesky amplification (the
// post alone) or an ASM eddie left on a Bluesky post (the eddie, then the
// post it replies to). The timestamp and the unavailable fallback open the
// ASM discussion for the Bluesky post, which is what web's
// /network/bluesky?uri= link resolves to.
export const ExternalActivityCard = memo(
  ({ item }: { item: ExternalProfileActivityItem }) => {
    const { theme } = useAppTheme();
    const router = useRouter();
    const openDiscussion = () =>
      router.push({ params: { uri: item.uri }, pathname: "/external-post" });
    const { comment } = item;
    const commentUsername = comment?.user?.username ?? "deleted";
    const commentName =
      comment?.user?.displayName || comment?.user?.username || "Deleted User";
    return (
      <View>
        {comment ? (
          <View
            style={[styles.comment, { borderBottomColor: theme.cardBorder }]}
          >
            <View style={styles.header}>
              <Pressable
                accessibilityLabel={`View @${commentUsername}'s profile`}
                accessibilityRole="link"
                onPress={() =>
                  router.push({
                    params: { username: commentUsername },
                    pathname: "/users/[username]",
                  })
                }
              >
                <Text
                  numberOfLines={1}
                  style={[styles.name, { color: theme.inputText }]}
                >
                  {commentName}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Open Bluesky discussion"
                accessibilityRole="link"
                onPress={openDiscussion}
              >
                <Text style={[styles.date, { color: theme.dividerText }]}>
                  {formatRelativeDate(item.createdAt)}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.context, { color: theme.dividerText }]}>
              Replying to a Bluesky post
            </Text>
            <View style={styles.body}>
              {comment.withheld ? (
                <Text style={[styles.withheld, { color: theme.inputText }]}>
                  This eddie is hidden by your content settings.
                </Text>
              ) : (
                <BioContent
                  apiBase={getApiBaseUrl()}
                  bio={comment.content}
                  textSize={{ fontSize: 14, lineHeight: 20 }}
                />
              )}
            </View>
          </View>
        ) : null}
        {item.post ? (
          <BlueskyPostCard post={item.post} />
        ) : (
          <Pressable
            accessibilityRole="link"
            onPress={openDiscussion}
            style={styles.unavailable}
          >
            <Text
              style={[styles.unavailableText, { color: theme.dividerText }]}
            >
              Source post unavailable. Open asocialmedia discussion.
            </Text>
          </Pressable>
        )}
      </View>
    );
  }
);
ExternalActivityCard.displayName = "ExternalActivityCard";

const styles = StyleSheet.create({
  body: { marginTop: 8 },
  comment: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  context: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 4 },
  date: { fontFamily: "SofiaProReg", fontSize: 12, marginLeft: 8 },
  header: { alignItems: "baseline", flexDirection: "row" },
  name: { flexShrink: 1, fontFamily: "SofiaProBold", fontSize: 14 },
  unavailable: { padding: 16 },
  unavailableText: { fontFamily: "SofiaProReg", fontSize: 14 },
  withheld: { fontFamily: "SofiaProReg", fontSize: 14, lineHeight: 20 },
});
