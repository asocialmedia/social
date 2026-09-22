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
import { useEffect, useState } from "react";
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

function ActionLabel({ children }: { children: string }) {
  const { theme } = useAppTheme();
  return (
    <Text style={[styles.label, { color: theme.dividerText }]}>{children}</Text>
  );
}

interface VoteClusterProps {
  aura: number;
  onRequireLogin: () => void;
  postId: string;
  userVote: number;
  viewerLoggedIn: boolean;
}

export function VoteCluster({
  aura: initialAura,
  onRequireLogin,
  postId,
  userVote: initialVote,
  viewerLoggedIn,
}: VoteClusterProps) {
  const { theme } = useAppTheme();
  const [aura, setAura] = useState(initialAura);
  const [userVote, setUserVote] = useState(initialVote);

  // Reconcile with the server snapshot on mount (web's vote-info query).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const context = await mutationContext();
      const info = await fetchVoteInfo(postId, context);
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
  }, [postId]);

  const cast = (value: 1 | -1) => {
    if (!viewerLoggedIn) {
      onRequireLogin();
      return;
    }
    const toggleOff = userVote === value;
    const target = toggleOff ? 0 : value;
    const previous = { aura, userVote };
    // Optimistic: +-1 per vote delta, like web calculateVoteChange.
    setUserVote(target);
    setAura(aura + (target - userVote));
    void (async () => {
      try {
        const context = await mutationContext();
        const info = await submitVote(postId, target, toggleOff, context);
        setAura(info.aura);
        setUserVote(info.userVote);
      } catch (error) {
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
      <Pressable
        accessibilityLabel="Amplify"
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => cast(1)}
        style={[styles.voteBtn, upActive && { backgroundColor: "#ff9500" }]}
      >
        <ArrowBigUp
          color={upActive ? "#ffffff" : theme.dividerText}
          fill={upActive ? "#ffffff" : "none"}
          size={16}
        />
      </Pressable>
      <Flame
        color={flame.color}
        fill={flame.filled ? flame.color : "none"}
        size={16}
      />
      <ActionLabel>{formatNumber(aura)}</ActionLabel>
      <Pressable
        accessibilityLabel="Mute"
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => cast(-1)}
        style={[styles.voteBtn, downActive && { backgroundColor: "#8b5cf6" }]}
      >
        <ArrowBigDown
          color={downActive ? "#ffffff" : theme.dividerText}
          fill={downActive ? "#ffffff" : "none"}
          size={16}
        />
      </Pressable>
    </View>
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

  useEffect(() => {
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
  }, [postId]);

  const toggle = () => {
    if (!viewerLoggedIn) {
      onRequireLogin();
      return;
    }
    const next = !bookmarked;
    setBookmarked(next);
    void (async () => {
      try {
        const context = await mutationContext();
        await submitBookmark(postId, next, context);
      } catch (error) {
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
});
