import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
// Post action bar pieces, ported from web's posts/actions cluster
// (aura-vote-button, bookmark-button) plus the presentational buttons
// (comment/respond/views/share/more). Vote and bookmark mutate optimistically
// against /api/posts/:id/votes and /bookmark with the stored session cookie,
// reconcile on success and roll back on failure, exactly like web. Guests are
// sent to login instead of firing mutations.
import {
  ArrowBigDown,
  ArrowBigUp,
  Bookmark,
  CornerDownRight,
  Eye,
  Flame,
  MessageSquare,
  MoreHorizontal,
  Share2,
} from "lucide-react-native";
import { useRef } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { useSessionContext } from "@/features/auth/state/session";
import {
  replyTargetFromPost,
  useComposerStore,
} from "@/features/composer/state/composer-store";
import { useAppTheme } from "@/theme";

import {
  formatNumber,
  getAuraFlameStyle,
} from "../../home/components/profile-utils";
import type { FeedPost } from "../lib/feed-types";
import { usePostEngagement } from "../state/use-post-engagement";
import type { MenuAnchor } from "./more-menu";

// `.vote-btn-up` / `.vote-btn-down` 3D dual-border shadows, light + dark.
// Resting vote buttons are bare (web's idle state); the gradient + ring only
// applies while the vote is active.
const VOTE_UP_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1.5px 2px rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(170, 60, 0, 0.45), 0 1px 1px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.1)";
const VOTE_UP_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";
const VOTE_DOWN_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1.5px 2px rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(70, 40, 170, 0.45), 0 1px 1px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.1)";
const VOTE_DOWN_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(70, 40, 170, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

function ActionLabel({ children }: { children: string }) {
  const { theme } = useAppTheme();
  return (
    <Text style={[styles.label, { color: theme.dividerText }]}>{children}</Text>
  );
}

interface VoteClusterProps {
  aura: number;
  // When set, the vote targets a comment eddie instead of a post, sharing
  // the optimistic flow against /api/comments/:id/vote like web.
  commentId?: string;
  onRequireLogin: () => void;
  postId: string;
  userVote: number;
  viewerId: string | null;
}

export function VoteCluster({
  aura: initialAura,
  commentId,
  onRequireLogin,
  postId,
  userVote: initialVote,
  viewerId,
}: VoteClusterProps) {
  const { isDark, theme } = useAppTheme();
  // The payload already carries the viewer's own vote, so this renders the
  // right number on first paint. The old version fired GET /votes on every
  // mount to fetch a value it already had, once per card, which is where the
  // request flood came from. `initialBookmarked` is deliberately left out: the
  // bookmark toggle owns that field, and claiming it here would reset it.
  const { engagement, vote } = usePostEngagement({
    aura: initialAura,
    commentId,
    postId,
    userVote: initialVote,
    viewerId,
  });

  const cast = async (value: 1 | -1) => {
    if (!viewerId) {
      onRequireLogin();
      return;
    }
    try {
      await vote(value);
    } catch {
      // The hook already rolled the optimistic value back and logged why;
      // nothing left for the button to do.
    }
  };

  const { aura, userVote } = engagement;
  const flame = getAuraFlameStyle(aura);
  const upActive = userVote === 1;
  const downActive = userVote === -1;
  return (
    <View style={styles.voteCluster}>
      <View style={styles.votePair}>
        <VoteButton
          active={upActive}
          colors={["#ff9500", "#e65500"]}
          label="Amplify"
          onPress={() => cast(1)}
          shadows={isDark ? VOTE_UP_SHADOWS_DARK : VOTE_UP_SHADOWS}
        >
          <ArrowBigUp
            color={upActive ? "#ffffff" : theme.dividerText}
            fill={upActive ? "#ffffff" : "none"}
            size={16}
          />
        </VoteButton>
        <VoteButton
          active={downActive}
          colors={["#7c5cff", "#5a3ae0"]}
          label="Mute"
          onPress={() => cast(-1)}
          shadows={isDark ? VOTE_DOWN_SHADOWS_DARK : VOTE_DOWN_SHADOWS}
        >
          <ArrowBigDown
            color={downActive ? "#ffffff" : theme.dividerText}
            fill={downActive ? "#ffffff" : "none"}
            size={16}
          />
        </VoteButton>
      </View>
      <Flame
        color={flame.color}
        fill={flame.filled ? flame.color : "none"}
        size={16}
      />
      <ActionLabel>{formatNumber(aura)}</ActionLabel>
    </View>
  );
}

function VoteButton({
  active,
  children,
  colors,
  label,
  onPress,
  shadows,
}: {
  active: boolean;
  children: ReactNode;
  colors: [string, string];
  label: string;
  onPress: () => void;
  shadows: string;
}) {
  if (!active) {
    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={6}
        onPress={onPress}
        style={styles.voteBtn}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <LinearGradient
      colors={colors}
      end={{ x: 0.5, y: 1 }}
      start={{ x: 0.5, y: 0 }}
      style={[styles.voteBtn, { boxShadow: shadows }]}
    >
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={6}
        onPress={onPress}
        style={styles.votePress}
      >
        {children}
      </Pressable>
    </LinearGradient>
  );
}

interface BookmarkToggleProps {
  initialBookmarked: boolean;
  onRequireLogin: () => void;
  postId: string;
  viewerId: string | null;
}

export function BookmarkToggle({
  initialBookmarked,
  onRequireLogin,
  postId,
  viewerId,
}: BookmarkToggleProps) {
  const { theme } = useAppTheme();
  // Same story as the vote cluster: the payload already says whether this
  // viewer bookmarked the post, so the old per-mount GET /bookmark was
  // refetching a known value on every card.
  const { engagement, toggleBookmark } = usePostEngagement({
    initialBookmarked,
    postId,
    viewerId,
  });
  const bookmarked = engagement.isBookmarkedByUser;

  const toggle = async () => {
    if (!viewerId) {
      onRequireLogin();
      return;
    }
    try {
      await toggleBookmark();
    } catch {
      // Rolled back and logged by the hook.
    }
  };

  return (
    <Pressable
      accessibilityLabel={bookmarked ? "Remove bookmark" : "Bookmark"}
      accessibilityRole="button"
      hitSlop={6}
      onPress={toggle}
      style={styles.iconHit}
    >
      <Bookmark
        color={bookmarked ? "#ffffff" : theme.dividerText}
        fill={bookmarked ? "#ffffff" : "none"}
        size={16}
        style={bookmarked ? styles.bookmarkActive : undefined}
      />
    </Pressable>
  );
}

interface CountButtonProps {
  count: number;
  icon: ReactNode;
  label: string;
  onPress?: () => void;
}

export function CountButton({ count, icon, label, onPress }: CountButtonProps) {
  const body = (
    <View style={styles.countBtn}>
      {icon}
      <ActionLabel>{formatNumber(count)}</ActionLabel>
    </View>
  );
  if (!onPress) {
    return (
      <View accessibilityLabel={label} accessibilityRole="text">
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

export function CommentButton({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <CountButton
      count={count}
      icon={
        <MessageSquare
          color={theme.dividerText}
          fill={count > 0 ? theme.dividerText : "none"}
          size={16}
        />
      }
      label="Eddies"
      onPress={onPress}
    />
  );
}

// Web's RespondButton: the direct response count, and a tap that opens the
// composer as a Respond (a threaded post reply) to this post. Guests go to
// login first, like every other gated action.
export function RespondButton({
  count,
  post,
}: {
  count: number;
  post?: FeedPost;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { user } = useSessionContext();
  const openComposer = useComposerStore((state) => state.open);
  return (
    <CountButton
      count={count}
      icon={<CornerDownRight color={theme.dividerText} size={16} />}
      label="Respond to this post"
      onPress={
        post
          ? () => {
              if (!user) {
                router.push("/(auth)/login");
                return;
              }
              openComposer("post", replyTargetFromPost(post));
            }
          : undefined
      }
    />
  );
}

export function ViewsBadge({ count }: { count: number }) {
  const { theme } = useAppTheme();
  return (
    <View accessibilityLabel="Views" accessibilityRole="text">
      <View style={styles.countBtn}>
        <Eye color={theme.dividerText} size={16} />
        <ActionLabel>{formatNumber(count)}</ActionLabel>
      </View>
    </View>
  );
}

export function ShareButton({ onPress }: { onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel="Share"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={styles.iconHit}
    >
      <Share2 color={theme.dividerText} size={16} />
    </Pressable>
  );
}

// Web's `...` trigger: a 28px round pill-3d-hover button in muted
// foreground that nudges down while pressed. It reports its own window rect
// so the dropdown can anchor under it.
export function MoreButton({
  onPress,
}: {
  onPress: (anchor: MenuAnchor) => void;
}) {
  const { isDark, theme } = useAppTheme();
  const triggerRef = useRef<View>(null);
  const pressedTone = isDark ? TRIGGER_PRESSED_DARK : TRIGGER_PRESSED_LIGHT;
  return (
    <Pressable
      accessibilityLabel="Post options"
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        triggerRef.current?.measureInWindow((x, y, width, height) => {
          onPress({ height, width, x, y });
        });
      }}
      ref={triggerRef}
      style={styles.iconHit}
    >
      {({ pressed }) => (
        <View
          style={[styles.moreTrigger, pressed && styles.moreTriggerPressed]}
        >
          {/* Mounted fresh on press: a shadow added to an existing view
              ignores its radius on Android and draws square. */}
          {pressed ? (
            <Gradient3D
              colors={pressedTone.gradient}
              shadows={pressedTone.shadows}
              style={styles.moreTriggerFill}
            />
          ) : null}
          <MoreHorizontal
            color={pressed ? pressedTone.color : theme.dividerText}
            size={16}
          />
        </View>
      )}
    </Pressable>
  );
}

// `.pill-3d-hover:hover`, light + dark.
const TRIGGER_PRESSED_LIGHT = {
  color: "#1c1f26",
  gradient: ["#e4e7ec", "#c6ccd5"],
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1.5px 2px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.06)",
} as const;
const TRIGGER_PRESSED_DARK = {
  color: "#ffffff",
  gradient: ["#8f96a3", "#5c6370"],
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)",
} as const;

const styles = StyleSheet.create({
  bookmarkActive: {
    backgroundColor: "#f59e0b",
    borderRadius: 9999,
    padding: 2,
  },
  countBtn: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 28,
    paddingHorizontal: 4,
  },
  iconHit: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  label: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  moreTrigger: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  moreTriggerFill: {
    borderRadius: 9999,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  moreTriggerPressed: {
    transform: [{ translateY: 1 }],
  },
  voteBtn: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  voteCluster: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  votePair: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  votePress: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
