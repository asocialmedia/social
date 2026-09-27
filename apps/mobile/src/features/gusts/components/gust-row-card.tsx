import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  Clapperboard,
  Eye,
  Flame,
  MessageSquare,
  Play,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { mediaImageUrl, mediaPosterUrl } from "@/features/feed/lib/media-url";
import { getAuraFlameStyle } from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import { formatNumber } from "@/lib/format-number";
import { useAppTheme } from "@/theme";

// Compact gust card used in feeds that mix gusts and regular posts (profile
// amplified, bookmarks): a 9:16 preview with the author, content, and
// metrics alongside. Links directly to the gusts reel viewer.
export function GustRowCard({
  onOpen,
  post,
}: {
  onOpen?: (post: FeedPost) => void;
  post: FeedPost;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const apiBase = getApiBaseUrl();

  const video = post.attachments?.find((att) => att.type === "VIDEO");
  const image = post.attachments?.find((att) => att.type !== "VIDEO");
  const flame = getAuraFlameStyle(post.aura ?? 0);
  const author = post.user?.displayName || post.user?.username || "Anonymous";
  const commentCount = post._count?.comments ?? 0;

  let posterUri: string | null = null;
  if (video) {
    posterUri = mediaPosterUrl(apiBase, video.id);
  } else if (image) {
    posterUri = mediaImageUrl(apiBase, image);
  }

  const handlePress = () => {
    if (onOpen) {
      onOpen(post);
      return;
    }
    router.push({ params: { id: post.id }, pathname: "/gusts" });
  };

  return (
    <Pressable
      accessibilityLabel={`Open Gust by ${author}`}
      accessibilityRole="button"
      onPress={handlePress}
      style={[
        styles.card,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
        },
      ]}
    >
      {/* 9:16 thumbnail poster with Gust badge and play indicator */}
      <View style={styles.thumbnailWrap}>
        {posterUri ? (
          <Image
            contentFit="cover"
            source={{ uri: posterUri }}
            style={[
              styles.thumbnail,
              post.explicitContent ? styles.blurred : null,
            ]}
          />
        ) : (
          <View style={[styles.thumbnail, styles.fallbackThumbnail]} />
        )}
        <View style={styles.chip}>
          <Clapperboard color="#f97316" size={10} />
          <Text style={styles.chipText}>Gust</Text>
        </View>
        <View pointerEvents="none" style={styles.playBadge}>
          <Play color="#ffffff" fill="#ffffff" size={14} />
        </View>
      </View>
      {/* Right column: author, content preview, and engagement metrics */}
      <View style={styles.contentCol}>
        <View style={styles.authorRow}>
          <UserAvatar
            radius={10}
            seed={post.user?.username ?? post.user?.id}
            size={24}
            url={post.user?.avatarUrl ?? null}
            userId={post.user?.id}
            username={post.user?.username}
          />
          <View style={styles.authorInfo}>
            <View style={styles.nameBadges}>
              <Text
                numberOfLines={1}
                style={[styles.displayName, { color: theme.inputText }]}
              >
                {author}
              </Text>
              {post.user ? (
                <UserBadge badge={post.user.badge} badges={post.user.badges} />
              ) : null}
            </View>
            {post.user?.username ? (
              <Text
                numberOfLines={1}
                style={[styles.handle, { color: theme.dividerText }]}
              >
                @{post.user.username}
              </Text>
            ) : null}
          </View>
        </View>

        {post.content ? (
          <Text
            numberOfLines={3}
            style={[styles.content, { color: theme.inputText }]}
          >
            {post.content}
          </Text>
        ) : null}

        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Eye color={theme.dividerText} size={12} />
            <Text style={[styles.metricText, { color: theme.dividerText }]}>
              {formatNumber(post.viewCount ?? 0)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Flame
              color={flame.color}
              fill={flame.filled ? flame.color : "none"}
              size={12}
            />
            <Text style={[styles.metricText, { color: theme.dividerText }]}>
              {formatNumber(post.aura ?? 0)}
            </Text>
          </View>
          <View style={styles.metric}>
            <MessageSquare color={theme.dividerText} size={12} />
            <Text style={[styles.metricText, { color: theme.dividerText }]}>
              {formatNumber(commentCount)}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  authorInfo: {
    flex: 1,
    minWidth: 0,
  },
  authorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  blurred: {
    opacity: 0.5,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 10,
  },
  chip: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: "absolute",
    top: 6,
  },
  chipText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
  },
  content: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    lineHeight: 18,
  },
  contentCol: {
    flex: 1,
    justifyContent: "space-between",
    minWidth: 0,
    paddingVertical: 2,
  },
  displayName: {
    fontFamily: "SofiaProBold",
    fontSize: 13,
  },
  fallbackThumbnail: {
    backgroundColor: "rgba(128,128,128,0.2)",
  },
  handle: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
  },
  metric: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  metricText: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
  },
  metricsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    marginTop: 4,
  },
  nameBadges: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  playBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 999,
    height: 32,
    justifyContent: "center",
    left: "50%",
    marginLeft: -16,
    marginTop: -16,
    position: "absolute",
    top: "50%",
    width: 32,
  },
  thumbnail: {
    height: "100%",
    width: "100%",
  },
  thumbnailWrap: {
    aspectRatio: 9 / 16,
    backgroundColor: "#000000",
    borderRadius: 12,
    height: 130,
    overflow: "hidden",
    position: "relative",
  },
});
