import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { ConcealedMediaCover } from "@/features/feed/components/concealed-media-cover";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import {
  mediaGridImageUrl,
  mediaPosterUrl,
} from "@/features/feed/lib/media-url";
import { UserBadge } from "@/features/home/components/user-badge";
import { fetchPostDetail } from "@/features/post/lib/post-api";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { surface3d } from "../lib/message-recipes";
import { MessageImage } from "./messages-primitives";

const cache = new Map<string, Promise<FeedPost>>();
export function MessagePostPreview({ postId }: { postId: string }) {
  const router = useRouter();
  const { user } = useSessionContext();
  const { theme, isDark } = useAppTheme();
  const panel = surface3d(isDark);
  const [post, setPost] = useState<FeedPost | null>(null);
  const [failed, setFailed] = useState(false);
  const apiBase = getApiBaseUrl();
  useEffect(() => {
    let active = true;
    const key = `${apiBase}:${user?.id ?? "guest"}:${postId}`;
    const load = async () => {
      let request = cache.get(key);
      if (!request) {
        request = (async () => {
          const detail = await fetchPostDetail(postId, {
            apiBase,
            cookie: await authClient.getCookie(),
          });
          return detail.post;
        })();
        cache.set(key, request);
        if (cache.size > 32) {
          const oldest = cache.keys().next().value;
          if (oldest) {
            cache.delete(oldest);
          }
        }
      }
      try {
        const result = await request;
        if (active) {
          setPost(result);
          setFailed(false);
        }
      } catch {
        cache.delete(key);
        if (active) {
          setFailed(true);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [apiBase, postId, user?.id]);
  const media = post?.attachments?.[0];
  let preview: string | null = null;
  if (media) {
    preview = media.mimeType?.startsWith("video/")
      ? mediaPosterUrl(apiBase, media.id)
      : mediaGridImageUrl(apiBase, media);
  }
  const handleOpen = () =>
    router.push({ params: { postId }, pathname: "/posts/[postId]" });
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="View shared post"
      onPress={handleOpen}
      style={{
        backgroundColor: panel.background,
        borderRadius: 14,
        boxShadow: panel.shadows,
        maxWidth: 320,
        minWidth: 220,
        overflow: "hidden",
      }}
    >
      <View style={{ gap: 8, padding: 12 }}>
        {post?.user ? (
          <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
            <UserAvatar
              url={post.user.avatarUrl}
              userId={post.user.id}
              size={28}
            />
            <View style={{ flex: 1 }}>
              <View
                style={{ alignItems: "center", flexDirection: "row", gap: 4 }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.inputText,
                    flexShrink: 1,
                    fontFamily: "SofiaProBold",
                    fontSize: 13,
                  }}
                >
                  {post.user.displayName ?? post.user.username}
                </Text>
                <UserBadge
                  badge={post.user.badge ?? null}
                  badges={post.user.badges ?? []}
                  communityRoles={post.user.communityMemberships ?? []}
                />
              </View>
              <Text
                style={{
                  color: theme.dividerText,
                  fontFamily: "SofiaProReg",
                  fontSize: 12,
                }}
              >
                @{post.user.username}
              </Text>
            </View>
          </View>
        ) : null}
        <Text
          numberOfLines={3}
          style={{
            color: theme.inputText,
            fontFamily: "SofiaProReg",
            fontSize: 14,
          }}
        >
          {post?.content ??
            (failed ? "This post is unavailable" : "Loading post…")}
        </Text>
      </View>
      {preview && (post?.explicitContent || post?.moderated) ? (
        <View
          style={{
            alignItems: "center",
            height: 160,
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {media ? (
            <ConcealedMediaCover apiBase={apiBase} media={media} />
          ) : null}
          <Text style={{ color: theme.inputText, fontFamily: "SofiaProMed" }}>
            {post.moderated ? "Restricted media" : "Sensitive media"}
          </Text>
        </View>
      ) : null}
      {preview && !post?.explicitContent && !post?.moderated ? (
        <MessageImage source={preview} style={{ height: 160, width: "100%" }} />
      ) : null}
      <View
        style={{
          borderTopColor: theme.dividerLine,
          borderTopWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          padding: 10,
        }}
      >
        <Text
          style={{
            color: theme.dividerText,
            fontFamily: "SofiaProReg",
            fontSize: 12,
          }}
        >
          asocialmedia
        </Text>
        <Text
          style={{
            color: theme.dividerText,
            fontFamily: "SofiaProMed",
            fontSize: 12,
          }}
        >
          View post ↗
        </Text>
      </View>
    </Pressable>
  );
}
