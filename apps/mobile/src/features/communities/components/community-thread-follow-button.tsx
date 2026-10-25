import { Bell, BellOff } from "lucide-react-native";
// oxlint-disable react/todo -- Requests own their visible loading and retry state.
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";

import { ZephLoader } from "@/components/feedback/zeph-loader";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { useAppTheme } from "@/theme";

import {
  fetchCommunityChatThreadFollowing,
  updateCommunityChatThreadFollowing,
} from "../lib/community-chat-api";

interface Props {
  options: () => Promise<ApiCallOptions>;
  slug: string;
  threadId: string;
}

export function CommunityThreadFollowButton({
  options,
  slug,
  threadId,
}: Props) {
  const { theme } = useAppTheme();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await fetchCommunityChatThreadFollowing(
          slug,
          threadId,
          await options()
        );
        if (!cancelled) {
          setFollowing(result.following);
          setFollowError(null);
        }
      } catch {
        if (!cancelled) {
          setFollowError("Couldn’t load thread notifications. Tap to retry.");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [options, slug, threadId]);

  async function toggle() {
    if (busy) {
      return;
    }
    setBusy(true);
    setFollowError(null);
    try {
      const requestOptions = await options();
      const result =
        following === null
          ? await fetchCommunityChatThreadFollowing(
              slug,
              threadId,
              requestOptions
            )
          : await updateCommunityChatThreadFollowing(
              slug,
              threadId,
              !following,
              requestOptions
            );
      setFollowing(result.following);
    } catch (error) {
      setFollowError(
        error instanceof Error
          ? error.message
          : "Couldn’t update thread notifications."
      );
    } finally {
      setBusy(false);
    }
  }

  const Icon = following ? BellOff : Bell;
  let label = "Loading thread notifications…";
  if (following !== null) {
    label = following ? "Following thread · Tap to unfollow" : "Follow thread";
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        followError ?? (following ? "Unfollow thread" : "Follow thread")
      }
      disabled={busy}
      onPress={toggle}
      style={{
        alignItems: "center",
        borderBottomColor: theme.cardBorder,
        borderBottomWidth: 1,
        flexDirection: "row",
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 18,
      }}
    >
      {busy ? (
        <ZephLoader variant="general" color={theme.dividerText} size="small" />
      ) : (
        <Icon color={theme.dividerText} size={15} />
      )}
      <Text
        style={{
          color: followError ? theme.errorBannerText : theme.dividerText,
          flexShrink: 1,
          fontFamily: "SofiaProReg",
          fontSize: 12,
        }}
      >
        {followError ?? label}
      </Text>
    </Pressable>
  );
}
