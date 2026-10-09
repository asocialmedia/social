// Web's UserAvatar: a squircle image with the `.avatar-ring` dual border and
// the placeholder when the url is missing or fails to load. Relative
// `/api/...` avatar urls resolve against the API base.
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { useSessionContext } from "@/features/auth/state/session";
import { resolveAvatarWithFallback } from "@/features/home/components/profile-utils";
import { usePopupProfile } from "@/features/home/components/use-popup-profile";
import { getApiBaseUrl } from "@/lib/api-env";
import {
  AVATAR_RING_SHADOWS,
  AVATAR_RING_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

export function UserAvatar({
  radius,
  seed,
  size,
  url,
  userId,
  username,
}: {
  radius?: number;
  seed?: string | null;
  size: number;
  url: string | null | undefined;
  userId?: string | null;
  username?: string | null;
}) {
  const { isDark } = useAppTheme();
  const apiBase = getApiBaseUrl();
  const avatarKey = seed || username || userId || null;
  const resolved = resolveAvatarWithFallback(url, apiBase, avatarKey);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cornerRadius = radius ?? Math.round(size * 0.3);
  const showImage = resolved !== null && failedUrl !== resolved;
  return (
    <View
      style={{
        backgroundColor: isDark ? "#232323" : "#f1f3f5",
        borderRadius: cornerRadius,
        height: size,
        overflow: "hidden",
        width: size,
      }}
    >
      <Image
        accessibilityLabel=""
        cachePolicy="memory-disk"
        contentFit="cover"
        onError={() => setFailedUrl(resolved)}
        source={showImage ? { uri: resolved } : avatarPlaceholder}
        style={{ borderRadius: cornerRadius, height: size, width: size }}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: cornerRadius,
            boxShadow: isDark ? AVATAR_RING_SHADOWS_DARK : AVATAR_RING_SHADOWS,
          },
        ]}
      />
    </View>
  );
}

// The signed-in reader's avatar with the header's precedence: the profile's
// custom upload (avatarUrl) over the session's OAuth image.
export function useViewerAvatarUrl(): string | null {
  const { user } = useSessionContext();
  const { hydrated, state: popup } = usePopupProfile(user?.id ?? null);
  if (!hydrated) {
    return null;
  }
  const profileAvatar =
    popup.status === "ready" ? popup.profile.avatarUrl : null;
  return profileAvatar ?? user?.image ?? null;
}
