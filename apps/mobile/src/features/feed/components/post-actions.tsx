import { LinearGradient } from "expo-linear-gradient";
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
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import {
  formatNumber,
  getAuraFlameStyle,
} from "../../home/components/profile-utils";
import {
  fetchBookmarkInfo,
  fetchVoteInfo,
  submitBookmark,
  submitVote,
} from "../lib/feed-api";

interface MutationContext {
  apiBase: string;
  cookie: string;
}

async function mutationContext(): Promise<MutationContext> {
  return { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() };
}

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
  viewerLoggedIn: boolean;
}

export function VoteCluster({
  aura: initialAura,
  commentId,
  onRequireLogin,
  postId,
  userVote: initialVote,
  viewerLoggedIn,
}: VoteClusterProps) {
  const { isDark, theme } = useAppTheme();
  const [aura, setAura] = useState(initialAura);
  const [userVote, setUserVote] = useState(initialVote);
  // Mutation generation: rapid taps resolve out of order, so only the
  // latest tap's response or rollback may touch state.
  const generationRef = useRef(0);

  // Reconcile with the server snapshot on mount (web's vote-info query).
  // Guests hold no vote state server-side, so there is nothing to read.
  // Comment rows carry their vote in props; skip the per-row fetch.
  useEffect(() => {
    if (!viewerLoggedIn || commentId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const context = await mutationContext();
      const info = await fetchVoteInfo(postId, context, commentId);
      if (!cancelled && info) {
        // oxlint-disable-next-line react/set-state-in-effect -- server reconciliation after mount, not derivable during render
        setAura(info.aura);
        // oxlint-disable-next-line react/set-state-in-effect -- same reconciliation as above
        setUserVote(info.userVote);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commentId, postId, viewerLoggedIn]);

  const cast = (value: 1 | -1) => {
    if (!viewerLoggedIn) {
      onRequireLogin();
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const toggleOff = userVote === value;
    const target = toggleOff ? 0 : value;
    const previous = { aura, userVote };
    // Optimistic: +-1 per vote delta, like web calculateVoteChange.
    setUserVote(target);
    setAura(aura + (target - userVote));
    void (async () => {
      try {
        const context = await mutationContext();
        const info = await submitVote(
          postId,
          target,
          toggleOff,
          context,
          commentId
        );
        if (generationRef.current !== generation) {
          return;
        }
        setAura(info.aura);
        setUserVote(info.userVote);
      } catch (error) {
        if (generationRef.current !== generation) {
          return;
        }
        setAura(previous.aura);
        setUserVote(previous.userVote);
        logWarn("feed.vote_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };

  const flame = getAuraFlameStyle(aura);
  const upActive = userVote === 1;
  const downActive = userVote === -1;
  return (
    <View style={styles.voteCluster}>
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
      <Flame
        color={flame.color}
        fill={flame.filled ? flame.color : "none"}
        size={16}
      />
      <ActionLabel>{formatNumber(aura)}</ActionLabel>
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
  viewerLoggedIn: boolean;
}

export function BookmarkToggle({
  initialBookmarked,
  onRequireLogin,
  postId,
  viewerLoggedIn,
}: BookmarkToggleProps) {
  const { theme } = useAppTheme();
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!viewerLoggedIn) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const context = await mutationContext();
      const info = await fetchBookmarkInfo(postId, context);
      if (!cancelled && info !== null) {
        // oxlint-disable-next-line react/set-state-in-effect -- server reconciliation after mount, not derivable during render
        setBookmarked(info);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, viewerLoggedIn]);

  const toggle = () => {
    if (!viewerLoggedIn) {
      onRequireLogin();
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const next = !bookmarked;
    setBookmarked(next);
    void (async () => {
      try {
        const context = await mutationContext();
        await submitBookmark(postId, next, context);
      } catch (error) {
        if (generationRef.current !== generation) {
          return;
        }
        setBookmarked(!next);
        logWarn("feed.bookmark_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
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

export function RespondButton({ count }: { count: number }) {
  const { theme } = useAppTheme();
  // Static until the composer lands: shows the response count like web, but
  // tapping has nowhere to go yet.
  return (
    <CountButton
      count={count}
      icon={<CornerDownRight color={theme.dividerText} size={16} />}
      label="Responses (composer coming soon)"
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

export function MoreButton({ onPress }: { onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel="More options"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={styles.iconHit}
    >
      <MoreHorizontal color={theme.dividerText} size={16} />
    </Pressable>
  );
}

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
    gap: 2,
  },
  votePress: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
