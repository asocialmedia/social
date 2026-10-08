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
  BookmarkCheck,
  BookmarkX,
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

import { toast } from "@/components/feedback/toast";
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

// Web's bookmark-button active `shadow-[...]`: same dual-border construction as
// the vote buttons, tuned to the amber fill. One recipe for both themes, as on
// web (no separate light/dark variant there).
const BOOKMARK_ACTIVE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(150, 90, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

function ActionLabel({
  children,
  color,
  fontSize = 12,
}: {
  children: string;
  color?: string;
  fontSize?: number;
}) {
  const { theme } = useAppTheme();
  return (
    <Text
      style={[styles.label, { color: color ?? theme.dividerText, fontSize }]}
    >
      {children}
    </Text>
  );
}

interface VoteClusterProps {
  aura: number;
  // Web passes this down from its post card
  // (`apps/web/src/components/posts/actions/aura-vote-button.tsx`) and names the
  // author in the amplify and mute messages.
  authorName: string;
  // When set, the vote targets a comment eddie instead of a post, sharing
  // the optimistic flow against /api/comments/:id/vote like web.
  commentId?: string;
  // Override for surfaces that sit on black (media viewer). Defaults to the
  // theme divider tone used on feed cards.
  inactiveColor?: string;
  labelColor?: string;
  onRequireLogin: () => void;
  postId: string;
  // Button diameter and glyph size. The feed card keeps web's h-7 (28); the
  // media panel uses a smaller step-up so the row stays level without the
  // vote buttons dwarfing the eddie chip.
  size?: number;
  userVote: number;
  viewerId: string | null;
}

export function VoteCluster({
  aura: initialAura,
  authorName,
  commentId,
  inactiveColor,
  labelColor,
  onRequireLogin,
  postId,
  size = 28,
  userVote: initialVote,
  viewerId,
}: VoteClusterProps) {
  // Web's ratios at h-7: size-4 icon (16) and text-xs (12). Keep them
  // proportional so a larger cluster scales the glyph and the aura count too.
  const glyph = Math.round(size * 0.57);
  const labelSize = Math.round(size * 0.43);
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
    // Web's copy names the target ("post" or "eddie") in three of the six
    // messages, so the noun is resolved here rather than baked into the strings.
    const noun = commentId ? "eddie" : "post";
    let previousVote = 0;
    try {
      previousVote = engagement.userVote;
      const info = await vote(value);
      // `null` means a newer vote superseded this one: nothing landed, so there
      // is nothing to announce.
      if (!info) {
        return;
      }
      // Same four branches as web's `onMutate`, keyed off the server's resolved
      // vote rather than the optimistic one.
      if (info.userVote === 1) {
        toast({
          description: `Amplified ${authorName}'s ${noun}, nice boost!`,
          icon: <Flame color="#ff7a00" fill="#ff7a00" />,
          title: "+1 Aura",
        });
      } else if (info.userVote === -1) {
        toast({
          description: `You muted ${authorName}'s ${noun}, we'll show you fewer like this`,
          icon: <ArrowBigDown color="#7c5cff" fill="#7c5cff" />,
          title: "Muted",
        });
      } else if (previousVote === 1) {
        toast({
          description: "You can always amplify it again later",
          icon: <Flame color="#ff7a00" fill="#ff7a00" />,
          title: "Amplification Removed",
        });
      } else if (previousVote === -1) {
        toast({
          description: "It'll show up normally again",
          icon: <ArrowBigUp color="#7c5cff" fill="#7c5cff" />,
          title: "Mute Removed",
        });
      }
    } catch {
      // The hook already rolled the optimistic value back and logged why. Web
      // still says so out loud, because a vote that silently reverts reads as the
      // app ignoring the tap.
      toast({
        description: "That didn't go through, give it another try?",
        variant: "destructive",
      });
    }
  };

  const { aura, userVote } = engagement;
  const flame = getAuraFlameStyle(aura);
  const upActive = userVote === 1;
  const downActive = userVote === -1;
  const idleColor = inactiveColor ?? theme.dividerText;
  return (
    <View style={styles.voteCluster}>
      <View style={styles.votePair}>
        <VoteButton
          active={upActive}
          colors={["#ff9500", "#e65500"]}
          label="Amplify"
          onPress={() => cast(1)}
          shadows={isDark ? VOTE_UP_SHADOWS_DARK : VOTE_UP_SHADOWS}
          size={size}
        >
          <ArrowBigUp
            color={upActive ? "#ffffff" : idleColor}
            fill={upActive ? "#ffffff" : "none"}
            size={glyph}
          />
        </VoteButton>
        <VoteButton
          active={downActive}
          colors={["#7c5cff", "#5a3ae0"]}
          label="Mute"
          onPress={() => cast(-1)}
          shadows={isDark ? VOTE_DOWN_SHADOWS_DARK : VOTE_DOWN_SHADOWS}
          size={size}
        >
          <ArrowBigDown
            color={downActive ? "#ffffff" : idleColor}
            fill={downActive ? "#ffffff" : "none"}
            size={glyph}
          />
        </VoteButton>
      </View>
      <Flame
        color={flame.color}
        fill={flame.filled ? flame.color : "none"}
        size={glyph}
      />
      <ActionLabel color={labelColor} fontSize={labelSize}>
        {formatNumber(aura)}
      </ActionLabel>
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
  size,
}: {
  active: boolean;
  children: ReactNode;
  colors: [string, string];
  label: string;
  onPress: () => void;
  shadows: string;
  size: number;
}) {
  const buttonStyle = { borderRadius: 9999, height: size, width: size };
  if (!active) {
    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={6}
        onPress={onPress}
        style={[styles.voteBtn, buttonStyle]}
      >
        {children}
      </Pressable>
    );
  }
  // Web's `.vote-btn-up` / `.vote-btn-down` paint the gradient as the button
  // background and the box-shadow's inset layers above it. A bare
  // LinearGradient with `boxShadow` collapses that to the outer ring, because
  // RN draws an inset shadow on the view's own background and the gradient
  // covers it. Gradient3D stacks outer ring, gradient, inset lip, then content,
  // which is the web recipe exactly.
  return (
    <Gradient3D
      colors={colors}
      radius={9999}
      shadows={shadows}
      style={[styles.voteBtn, buttonStyle]}
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
    </Gradient3D>
  );
}

interface BookmarkToggleProps {
  inactiveColor?: string;
  initialBookmarked: boolean;
  onRequireLogin: () => void;
  postId: string;
  // Web's media panel downs the bookmark at h-9 w-9 (36) to match the share
  // button beside it, while the feed card keeps h-7 (28). The default matches
  // the feed; the media screen opts up so the two right-cluster buttons agree.
  size?: number;
  viewerId: string | null;
}

export function BookmarkToggle({
  inactiveColor,
  initialBookmarked,
  onRequireLogin,
  postId,
  size = 28,
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
      // Web's `onMutate` (`apps/web/src/components/posts/actions/bookmark-button.tsx`)
      // announces both directions, with the icon matching the outcome.
      toast({
        description: bookmarked
          ? "Removed from your bookmarks"
          : "Post saved, find it anytime in your bookmarks",
        icon: bookmarked ? (
          <BookmarkX color="#ffffff" />
        ) : (
          <BookmarkCheck color="#ffffff" />
        ),
        title: bookmarked ? "Bookmark Removed" : "Bookmarked",
      });
    } catch {
      // Rolled back and logged by the hook, but web still tells the reader: the
      // bookmark icon springs back with no explanation otherwise.
      toast({
        description: "That didn't go through, give it another try?",
        variant: "destructive",
      });
    }
  };

  return (
    <Pressable
      accessibilityLabel={bookmarked ? "Remove bookmark" : "Bookmark"}
      accessibilityRole="button"
      hitSlop={6}
      onPress={toggle}
      style={[styles.iconHit, { height: size, width: size }]}
    >
      {bookmarked ? (
        // Web's active bookmark fills the button with a full-strength amber
        // gradient plus the same dual-border recipe as the vote buttons
        // (gradient background, inset lip above it, matching ring). The previous
        // port tinted only the glyph and padded it into a smaller bubble, which
        // read as a flat dot rather than the raised, gradient-filled pill web
        // shows. Gradient3D keeps that stack intact on RN.
        <Gradient3D
          colors={["#fbbf24", "#d97706"]}
          radius={9999}
          shadows={BOOKMARK_ACTIVE_SHADOWS}
          style={[styles.bookmarkActive, { height: size, width: size }]}
        >
          <Bookmark
            color="#ffffff"
            fill="#ffffff"
            size={Math.round(size * 0.57)}
          />
        </Gradient3D>
      ) : (
        <Bookmark
          color={inactiveColor ?? theme.dividerText}
          fill="none"
          size={Math.round(size * 0.57)}
        />
      )}
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
    alignItems: "center",
    justifyContent: "center",
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
