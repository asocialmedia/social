import { Image } from "expo-image";
import { Clapperboard, Play } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { VoteCluster } from "@/features/feed/components/post-actions";
import type { FeedMedia, FeedPost } from "@/features/feed/lib/feed-types";
import {
  embedImageUrl,
  parseStoredEmbeds,
  youtubeEmbedThumbnail,
} from "@/features/feed/lib/link-embeds";
import type { LinkEmbed } from "@/features/feed/lib/link-embeds";
import { mediaGridImageUrl } from "@/features/feed/lib/media-url";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

function embedPreview(embed: LinkEmbed | undefined): string | null {
  if (!embed) {
    return null;
  }
  if (embed.type === "youtube") {
    return youtubeEmbedThumbnail(embed.videoId);
  }
  return embed.imageUrl ?? null;
}

function previewUrl(
  apiBase: string,
  media: FeedMedia | undefined,
  embed: LinkEmbed | undefined
): string | null {
  if (media) {
    return mediaGridImageUrl(apiBase, media);
  }
  const preview = embedPreview(embed);
  return preview ? embedImageUrl(apiBase, preview) : null;
}

function previewAspect(
  post: FeedPost,
  media: FeedMedia | undefined,
  embed: LinkEmbed | undefined
): number {
  if (post.isGust) {
    return 9 / 16;
  }
  if (media?.width && media.height) {
    return media.width / media.height;
  }
  if (embed) {
    return 16 / 9;
  }
  return 4 / 5;
}

export function ExplorePostCard({
  onPress,
  onRequireLogin,
  post,
  viewerLoggedIn,
}: {
  onPress: () => void;
  onRequireLogin: () => void;
  post: FeedPost;
  viewerLoggedIn: boolean;
}) {
  const { isDark, theme } = useAppTheme();
  const apiBase = getApiBaseUrl();
  const [imageFailed, setImageFailed] = useState(false);
  const media = post.attachments?.find(
    (attachment) => attachment.type === "IMAGE" || attachment.type === "VIDEO"
  );
  const embed = useMemo(() => parseStoredEmbeds(post.embeds)[0], [post.embeds]);
  const imageUrl = previewUrl(apiBase, media, embed);
  const isVideo = media?.type === "VIDEO";
  const aspectRatio = previewAspect(post, media, embed);

  return (
    <Pressable
      accessibilityLabel={`Open post by ${post.user?.displayName ?? post.user?.username ?? "user"}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      {post.moderated ? (
        <View style={[styles.muted, { borderColor: theme.dividerLine }]}>
          <Text style={[styles.mutedText, { color: theme.dividerText }]}>
            This post is no longer available.
          </Text>
        </View>
      ) : (
        <>
          {imageUrl ? (
            <View style={[styles.visual, { aspectRatio }]}>
              <Image
                accessibilityLabel="Post media"
                cachePolicy="memory-disk"
                contentFit="cover"
                onError={() => setImageFailed(true)}
                source={{ uri: imageUrl }}
                style={[styles.image, post.explicitContent && styles.explicit]}
              />
              {isVideo ? (
                <View style={styles.videoOverlay}>
                  <View style={styles.playButton}>
                    <Play color="#ffffff" fill="#ffffff" size={18} />
                  </View>
                </View>
              ) : null}
              {post.isGust ? (
                <View style={styles.gustBadge}>
                  <Clapperboard color="#ff9500" size={11} />
                  <Text style={styles.gustText}>Gust</Text>
                </View>
              ) : null}
              {imageFailed ? (
                <View
                  style={[
                    styles.imageFallback,
                    { backgroundColor: theme.dividerLine },
                  ]}
                />
              ) : null}
            </View>
          ) : null}
          <View style={styles.body}>
            {post.content ? (
              <Text
                numberOfLines={4}
                style={[styles.content, { color: theme.inputText }]}
              >
                {post.content}
              </Text>
            ) : null}
            <View style={styles.authorRow}>
              <UserAvatar size={28} url={post.user?.avatarUrl} />
              <View style={styles.authorCopy}>
                <View style={styles.authorNameRow}>
                  <Text
                    numberOfLines={1}
                    style={[styles.authorName, { color: theme.inputText }]}
                  >
                    {post.user?.displayName ??
                      post.user?.username ??
                      "Anonymous"}
                  </Text>
                  <UserBadge
                    badge={post.user?.badge}
                    badges={post.user?.badges}
                    communityRoles={post.user?.communityMemberships}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  style={[styles.username, { color: theme.dividerText }]}
                >
                  @{post.user?.username ?? "unknown"}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.footer}>
            <VoteCluster
              aura={post.aura ?? 0}
              onRequireLogin={onRequireLogin}
              postId={post.id}
              userVote={post.vote?.[0]?.value ?? 0}
              viewerLoggedIn={viewerLoggedIn}
            />
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  authorCopy: { flex: 1, minWidth: 0 },
  authorName: { fontFamily: "SofiaProMed", fontSize: 12, maxWidth: "100%" },
  authorNameRow: { alignItems: "center", flexDirection: "row", gap: 4 },
  authorRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  body: { gap: 10, padding: 12 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
  },
  content: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  explicit: { opacity: 0.6 },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  gustBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: "absolute",
    top: 8,
  },
  gustText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 10 },
  image: { height: "100%", width: "100%" },
  imageFallback: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  muted: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
    padding: 16,
  },
  mutedText: { fontFamily: "SofiaProReg", fontSize: 13, textAlign: "center" },
  playButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  username: { fontFamily: "SofiaProReg", fontSize: 11, marginTop: 2 },
  videoOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  visual: {
    backgroundColor: "rgba(128,128,128,0.15)",
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
});
