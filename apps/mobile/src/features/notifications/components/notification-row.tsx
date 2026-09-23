// One notification row: 1:1 native port of web's Notification component
// (app/(main)/notifications/notification.tsx).
//
// Same layout: a stacked avatar (single issuer, or up to three for a grouped
// amplify with a "+N" chip) with the type's gradient badge at the bottom-right,
// the headline (issuer name in bold ink, verb phrase in muted), a two-line post
// snippet, the relative timestamp, and a dismiss button. Copy, grouping and
// badge colors all come from @asm/notifications/shared, so the two clients
// cannot drift.
import type {
  NotificationIconName,
  NotificationTarget,
} from "@asm/notifications/shared";
import { presentNotification } from "@asm/notifications/shared";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  AtSign,
  Captions,
  CornerDownRight,
  Heart,
  LayoutGrid,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { formatRelativeDate } from "@/features/feed/lib/feed-types";
import { resolveProfileImageUrl } from "@/features/home/components/profile-utils";
import { getApiBaseUrl } from "@/lib/api-env";
import {
  AVATAR_RING_SHADOWS,
  AVATAR_RING_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import type { GroupedNotificationItem } from "../lib/notifications-api";

// Lucide exposes identical names in the web and native bundles, so the shared
// presenter's icon name resolves to the same glyph on both.
const ICONS: Record<
  NotificationIconName,
  ComponentType<{ color?: string; size?: number }>
> = {
  AtSign,
  Captions,
  CornerDownRight,
  Heart,
  LayoutGrid,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserPlus,
};

interface NotificationRowProps {
  notification: GroupedNotificationItem;
  onDismiss: (notification: GroupedNotificationItem) => void;
  onOpen: (target: NotificationTarget) => void;
}

// Web's type badge box-shadow, exact: a bright inner lip over the gradient plus
// a tight dark drop, never a symmetric bloom.
const BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1px 2px rgba(255, 255, 255, 0.4), 0 1px 2px rgba(0, 0, 0, 0.15)";

// The type mark: a gradient disc with the type's lucide glyph. Gradient3D
// carries the dual border (inset lip over the fill) the same way web's
// box-shadow list does, so the mark reads as a small enamel jewel rather than
// a flat colored circle.
function TypeBadge({
  badge,
  Icon,
  size,
  style,
}: {
  badge: { from: string; to: string };
  Icon: ComponentType<{ color?: string; size?: number }>;
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Gradient3D
      colors={[badge.from, badge.to]}
      radius={size / 2}
      shadows={BADGE_SHADOWS}
      style={[{ height: size, width: size }, style]}
    >
      <Icon color="#ffffff" size={Math.round(size * 0.55)} />
    </Gradient3D>
  );
}

function AvatarWithBadge({
  avatarUrl,
  badge,
  Icon,
  size,
}: {
  avatarUrl: string | null;
  badge: { from: string; to: string };
  Icon: ComponentType<{ color?: string; size?: number }>;
  size: number;
}) {
  const { isDark, theme } = useAppTheme();
  const [failed, setFailed] = useState(false);
  const uri = avatarUrl
    ? resolveProfileImageUrl(avatarUrl, getApiBaseUrl())
    : null;
  const badgeSize = size / 2;
  const radius = size / 3;

  return (
    <View style={{ height: size, width: size }}>
      <Image
        contentFit="cover"
        onError={() => setFailed(true)}
        source={uri && !failed ? { uri } : avatarPlaceholder}
        style={[
          styles.avatar,
          {
            backgroundColor: theme.cardBg,
            borderRadius: radius,
            height: size,
            width: size,
          },
        ]}
      />
      {/* avatar-ring bevel: boxShadow is not part of expo-image's ImageStyle,
          so the ring rides an overlay like the web box-shadow layer. */}
      <View
        pointerEvents="none"
        style={[
          styles.avatarRing,
          {
            borderRadius: radius,
            boxShadow: isDark ? AVATAR_RING_SHADOWS_DARK : AVATAR_RING_SHADOWS,
          },
        ]}
      />
      <TypeBadge
        badge={badge}
        Icon={Icon}
        size={badgeSize}
        style={styles.avatarBadge}
      />
    </View>
  );
}

function NotificationAvatars({
  issuers,
  badge,
  Icon,
  type,
}: {
  issuers: GroupedNotificationItem["issuers"];
  badge: { from: string; to: string };
  Icon: ComponentType<{ color?: string; size?: number }>;
  type: GroupedNotificationItem["type"];
}) {
  const { theme } = useAppTheme();

  if (type !== "AMPLIFY" || issuers.length <= 1) {
    const [single] = issuers;
    return (
      <AvatarWithBadge
        avatarUrl={single?.avatarUrl ?? null}
        badge={badge}
        Icon={Icon}
        size={40}
      />
    );
  }

  // Up to 3 avatars directly; beyond that, two avatars plus an inline "+N"
  // chip. `visible.length` is at most 3, so the row width is bounded.
  const visible = issuers.length <= 3 ? issuers : issuers.slice(0, 2);
  const remaining = issuers.length - visible.length;
  const step = 20;
  const chipWidth = remaining > 0 ? 36 : 0;
  const width =
    (visible.length - 1) * step + 36 + (remaining > 0 ? 8 + chipWidth : 0);

  return (
    <View style={[styles.stackWrap, { width }]}>
      {visible.map((issuer, index) => {
        const uri = issuer.avatarUrl
          ? resolveProfileImageUrl(issuer.avatarUrl, getApiBaseUrl())
          : null;
        return (
          <Image
            contentFit="cover"
            key={issuer.id}
            source={uri ? { uri } : avatarPlaceholder}
            style={[
              styles.stackItem,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.containerBg,
                borderRadius: 12,
                borderWidth: 2,
                height: 36,
                left: index * step,
                width: 36,
                // Newest issuer on top, like web's inline zIndex.
                zIndex: visible.length - index,
              },
            ]}
          />
        );
      })}
      {remaining > 0 ? (
        <View
          style={[
            styles.stackItem,
            styles.remaining,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.containerBg,
              left: (visible.length - 1) * step + 36 + 8,
            },
          ]}
        >
          <Text style={[styles.remainingText, { color: theme.inputText }]}>
            +{remaining}
          </Text>
        </View>
      ) : null}
      <TypeBadge
        badge={badge}
        Icon={Icon}
        size={20}
        style={styles.stackBadge}
      />
    </View>
  );
}

export function NotificationRow({
  notification,
  onDismiss,
  onOpen,
}: NotificationRowProps) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const issuers =
    notification.issuers.length > 0
      ? notification.issuers
      : [notification.issuer];
  const presentation = presentNotification(notification, issuers);
  const Icon = ICONS[presentation.icon];

  const handlePress = () => {
    // Community and user targets have no dedicated native screen yet, so they
    // land on the feed or the notifications list rather than a dead route.
    // Post targets open the detail screen, which the app already ships.
    if (presentation.target.kind === "post") {
      const shortId =
        presentation.target.postId.length > 8
          ? presentation.target.postId.slice(0, 8)
          : presentation.target.postId;
      router.push({ params: { postId: shortId }, pathname: "/posts/[postId]" });
      onOpen(presentation.target);
      return;
    }
    onOpen(presentation.target);
  };

  const unread = !notification.read;
  const unreadBackground = isDark
    ? "rgba(255, 149, 0, 0.10)"
    : "rgba(246, 107, 21, 0.07)";

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: unread ? unreadBackground : theme.containerBg,
        },
      ]}
    >
      <Pressable
        accessibilityLabel={presentation.action}
        accessibilityRole="button"
        onPress={handlePress}
        style={styles.pressable}
      >
        <NotificationAvatars
          badge={presentation.badge}
          Icon={Icon}
          issuers={issuers}
          type={notification.type}
        />

        <View style={styles.body}>
          <Text style={styles.headline} numberOfLines={2}>
            {presentation.headline.map((segment, index) => (
              <Text
                key={`${notification.id}-seg-${index}`}
                style={
                  segment.emphasis === "name"
                    ? { color: theme.inputText, fontFamily: "SofiaProBold" }
                    : { color: theme.dividerText, fontFamily: "SofiaProReg" }
                }
              >
                {segment.text}
              </Text>
            ))}
          </Text>

          {notification.post?.content ? (
            <Text
              numberOfLines={2}
              style={[styles.snippet, { color: theme.dividerText }]}
            >
              {notification.post.content}
            </Text>
          ) : null}

          <Text style={[styles.time, { color: theme.dividerText }]}>
            {formatRelativeDate(notification.createdAt)}
          </Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityLabel="Dismiss notification"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => onDismiss(notification)}
        style={({ pressed }) => [
          styles.dismiss,
          {
            backgroundColor: theme.passkeyBg,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <X color={theme.passkeyIcon} size={14} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    aspectRatio: 1,
  },
  avatarBadge: {
    bottom: -4,
    position: "absolute",
    right: -4,
  },
  avatarRing: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  dismiss: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
    marginTop: 4,
    width: 28,
  },
  headline: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 19,
  },
  pressable: {
    alignItems: "flex-start",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
  },
  remaining: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 2,
    height: 36,
    justifyContent: "center",
    position: "absolute",
    top: 0,
    width: 36,
  },
  remainingText: {
    fontFamily: "SofiaProBold",
    fontSize: 11,
    fontWeight: "normal",
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  snippet: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
    lineHeight: 18,
    marginTop: 4,
  },
  stackBadge: {
    bottom: -4,
    position: "absolute",
    right: -4,
  },
  stackItem: {
    position: "absolute",
    top: 0,
  },
  stackWrap: {
    height: 40,
    position: "relative",
  },
  time: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    fontWeight: "normal",
    marginTop: 4,
  },
});
