import { useRecyclingState } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import noMediaImage from "@/assets/images/nomedia.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import {
  ConcealedImageCover,
  ConcealedMediaCover,
} from "@/features/feed/components/concealed-media-cover";
import { ExternalVoteAction } from "@/features/feed/components/external-post-actions";
import { VoteCluster } from "@/features/feed/components/post-actions";
import { VideoTile } from "@/features/feed/components/post-media";
import { extractInlineMeta } from "@/features/feed/lib/feed-types";
import type { FeedMedia, FeedPost } from "@/features/feed/lib/feed-types";
import {
  embedImageUrl,
  parseStoredEmbeds,
} from "@/features/feed/lib/link-embeds";
import type { LinkEmbed } from "@/features/feed/lib/link-embeds";
import { mediaGridImageUrl } from "@/features/feed/lib/media-url";
import {
  BioContent,
  MentionChip,
  TagChip,
} from "@/features/home/components/bio-content";
import { resolveAvatarWithFallback } from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import {
  embedPreview,
  embedSiteLabel,
  selectPreviewEmbed,
} from "../lib/explore-embed";
import { ExploreBadge } from "./explore-badge";

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
  viewerId,
}: {
  onPress: () => void;
  onRequireLogin: () => void;
  post: FeedPost;
  viewerId: string | null;
}) {
  const { isDark, theme } = useAppTheme();
  const apiBase = getApiBaseUrl();
  const [imageFailed, setImageFailed] = useRecyclingState(false, [post.id]);
  const media = post.attachments?.find(
    (attachment) => attachment.type === "IMAGE" || attachment.type === "VIDEO"
  );
  const embed = useMemo(
    () => selectPreviewEmbed(parseStoredEmbeds(post.embeds)),
    [post.embeds]
  );
  const imageUrl = previewUrl(apiBase, media, embed);
  const embedTextRow =
    !media && embed && (!imageUrl || imageFailed) ? embed : null;
  const aspectRatio = previewAspect(post, media, embed);
  const inline = useMemo(
    () => extractInlineMeta(post.content ?? ""),
    [post.content]
  );
  const extraTags = (post.tags ?? []).filter(
    (tag) => !inline.tags.has(tag.name.toLowerCase())
  );
  const extraMentions = (post.mentions ?? []).filter(
    (mention) =>
      mention.user?.username &&
      !inline.usernames.has(mention.user.username.toLowerCase())
  );

  const concealedPreview = media ? (
    <ConcealedMediaCover
      accessibilityLabel="Blurred explicit media preview"
      apiBase={apiBase}
      media={media}
    />
  ) : (
    <ConcealedImageCover
      accessibilityLabel="Blurred explicit media preview"
      uri={imageUrl}
    />
  );

  let visual = (
    <Image
      recyclingKey={imageUrl}
      accessibilityLabel="Post media"
      cachePolicy="memory-disk"
      contentFit="cover"
      onError={() => setImageFailed(true)}
      source={{ uri: imageUrl ?? undefined }}
      style={styles.image}
    />
  );
  if (post.explicitContent) {
    visual = concealedPreview;
  } else if (media?.type === "VIDEO") {
    visual = (
      <VideoTile
        key={media.id}
        apiBase={apiBase}
        autoPlayEnabled
        exclusiveAutoplay
        observationPost={post}
        media={media}
        onPressPreview={onPress}
        postId={post.id}
        tile
      />
    );
  }

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
          {/* Web's visual frame shows for native media or any link embed. A
              plain link, or an embed image that fails, becomes the text row;
              failed media shows the nomedia art. */}
          {media || embed ? (
            <View style={[styles.visual, { aspectRatio }]}>
              {embedTextRow ? (
                <View style={styles.embedRow}>
                  <Text
                    numberOfLines={1}
                    style={[styles.embedSite, { color: theme.dividerText }]}
                  >
                    {embedSiteLabel(embedTextRow)}
                  </Text>
                  <Text
                    numberOfLines={3}
                    style={[styles.embedTitle, { color: theme.inputText }]}
                  >
                    {embedTextRow.title}
                  </Text>
                </View>
              ) : (
                visual
              )}
              {post.isGust ? (
                <ExploreBadge kind="gust" style={styles.gustBadge} />
              ) : null}
              {!media && embed && !embedTextRow ? (
                <View style={styles.siteChip}>
                  <Text numberOfLines={1} style={styles.siteChipText}>
                    {embedSiteLabel(embed)}
                  </Text>
                </View>
              ) : null}
              {media && imageFailed ? (
                <View
                  style={[
                    styles.imageFallback,
                    styles.imageFallbackArt,
                    { backgroundColor: theme.dividerLine },
                  ]}
                >
                  <Image
                    accessibilityLabel={
                      media.type === "VIDEO"
                        ? "Post video unavailable"
                        : "Post media unavailable"
                    }
                    contentFit="contain"
                    source={noMediaImage}
                    style={styles.fallbackImage}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.body}>
            {post.content ? (
              <BioContent
                key={post.id}
                apiBase={apiBase}
                bio={post.content}
                sourceSegments={post.external?.segments}
                clampLength={180}
                textSize={styles.content}
              />
            ) : null}
            {extraTags.length > 0 || extraMentions.length > 0 ? (
              <View style={styles.meta}>
                {extraTags.map((tag) => (
                  <TagChip key={tag.id} tag={tag.name} />
                ))}
                {extraMentions.map((mention) => (
                  <MentionChip
                    key={mention.user.id}
                    avatarUrl={resolveAvatarWithFallback(
                      mention.user.avatarUrl,
                      apiBase,
                      mention.user.username || mention.user.id
                    )}
                    username={mention.user.username ?? "unknown"}
                  />
                ))}
              </View>
            ) : null}
            <View style={styles.authorRow}>
              <UserAvatar size={32} url={post.user?.avatarUrl} />
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
                  {post.external ? (
                    <Text style={{ color: theme.dividerText, fontSize: 11 }}>
                      Bluesky
                    </Text>
                  ) : (
                    <UserBadge
                      badge={post.user?.badge}
                      badges={post.user?.badges}
                      communityRoles={post.user?.communityMemberships}
                    />
                  )}
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
            {post.external ? (
              <ExternalVoteAction post={post.external} />
            ) : (
              <VoteCluster
                aura={post.aura ?? 0}
                authorName={
                  post.user?.displayName ?? post.user?.username ?? "unknown"
                }
                onRequireLogin={onRequireLogin}
                postId={post.id}
                userVote={post.vote?.[0]?.value ?? 0}
                viewerId={viewerId}
              />
            )}
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  authorCopy: { flex: 1, minWidth: 0 },
  authorName: {
    flexShrink: 1,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    minWidth: 0,
  },
  authorNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    maxWidth: "100%",
  },
  authorRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  body: { gap: 10, padding: 12 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
    width: "100%",
  },
  content: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  embedRow: {
    flex: 1,
    gap: 4,
    justifyContent: "flex-end",
    padding: 12,
  },
  embedSite: { fontFamily: "SofiaProReg", fontSize: 11 },
  embedTitle: { fontFamily: "SofiaProMed", fontSize: 14, lineHeight: 18 },
  fallbackImage: { height: "60%", opacity: 0.6, width: "60%" },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  gustBadge: { left: 8, position: "absolute", top: 8 },
  image: { height: "100%", width: "100%" },
  imageFallback: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  imageFallbackArt: { alignItems: "center", justifyContent: "center" },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  muted: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
    padding: 16,
  },
  mutedText: { fontFamily: "SofiaProReg", fontSize: 13, textAlign: "center" },
  // Web's `chip-3d explore-gust-chip`: the site mark on a link preview.
  siteChip: {
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    borderRadius: 9999,
    boxShadow:
      "inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 1px 2px rgba(0, 0, 0, 0.25)",
    left: 8,
    maxWidth: "70%",
    paddingHorizontal: 8,
    paddingVertical: 2,
    position: "absolute",
    top: 8,
  },
  siteChipText: { color: "#ffffff", fontFamily: "SofiaProBold", fontSize: 10 },
  username: { fontFamily: "SofiaProReg", fontSize: 11, marginTop: 2 },
  visual: {
    backgroundColor: "rgba(128,128,128,0.15)",
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
});
