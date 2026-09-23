// Native share sheet for a post, mirroring web ShareButton's link tab
// (share-button.tsx): title, description, share stats, and a system share
// action that records the share server-side. The shared URL is the canonical
// short post path on the production origin, like web's getPostUrl.
import { Link2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { PROD_API_URL } from "@/lib/api-base";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import { fetchShareStats, submitShare } from "../lib/feed-api";
import type { ShareStats } from "../lib/feed-api";
import type { FeedPost } from "../lib/feed-types";

export function getSharePostUrl(post: FeedPost): string {
  const shortId = post.id.length > 8 ? post.id.slice(0, 8) : post.id;
  const path = post.community?.slug
    ? `/a/${post.community.slug}/posts/${shortId}`
    : `/posts/${shortId}`;
  return `${PROD_API_URL}${path}`;
}

interface ShareSheetProps {
  // Web's dialogTitle / dialogDescription / shareUrl overrides; gusts share
  // "Share Gust" and /gusts?id=<full id> instead of the post path.
  description?: string;
  onClose: () => void;
  post: FeedPost | null;
  shareUrl?: (post: FeedPost) => string;
  title?: string;
}

export function ShareSheet({
  description = "Share this post with your network",
  onClose,
  post,
  shareUrl = getSharePostUrl,
  title = "Share Post",
}: ShareSheetProps) {
  const { isDark, theme } = useAppTheme();
  const [stats, setStats] = useState<ShareStats[]>([]);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!post) {
      return;
    }
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- stats load when the sheet opens for a post; nothing to derive during render
    setStats([]);
    // oxlint-disable-next-line react/set-state-in-effect -- a fresh post resets the shared flag
    setShared(false);
    void (async () => {
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        const rows = await fetchShareStats(post.id, { apiBase, cookie });
        if (!cancelled) {
          // oxlint-disable-next-line react/set-state-in-effect -- settling the stats load above
          setStats(rows);
        }
      } catch {
        // Stats are decorative; a failure just hides the row.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [post]);

  const totalShares = stats.reduce((sum, row) => sum + row.shares, 0);
  const totalClicks = stats.reduce((sum, row) => sum + row.clicks, 0);

  const share = () => {
    if (!post) {
      return;
    }
    void (async () => {
      const url = shareUrl(post);
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        await submitShare(post.id, "system", { apiBase, cookie });
        setShared(true);
      } catch (error) {
        logWarn("feed.share_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        await Share.share({ message: url, url });
      } catch {
        // Dismissing the system sheet throws; not an error.
      }
    })();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={post !== null}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={() => {
            /* taps on the sheet must not bubble to the backdrop */
          }}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
            },
          ]}
        >
          <View style={styles.handle} />
          <Text style={[styles.title, { color: theme.inputText }]}>
            {title}
          </Text>
          <Text style={[styles.description, { color: theme.dividerText }]}>
            {description}
          </Text>
          {totalShares > 0 || totalClicks > 0 ? (
            <Text style={[styles.stats, { color: theme.dividerText }]}>
              {totalShares} {totalShares === 1 ? "share" : "shares"} ·{" "}
              {totalClicks} {totalClicks === 1 ? "click" : "clicks"}
            </Text>
          ) : null}
          <Pressable
            accessibilityLabel="Share this post"
            accessibilityRole="button"
            onPress={share}
            style={styles.shareBtn}
          >
            <Link2 color="#ffffff" size={16} />
            <Text style={styles.shareText}>{shared ? "Shared!" : "Share"}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    flex: 1,
    justifyContent: "flex-end",
  },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 4,
    textAlign: "center",
  },
  handle: {
    alignSelf: "center",
    backgroundColor: "rgba(128, 128, 128, 0.5)",
    borderRadius: 9999,
    height: 4,
    marginBottom: 12,
    width: 40,
  },
  shareBtn: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 16,
    paddingVertical: 12,
  },
  shareText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  stats: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 8,
    textAlign: "center",
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
    textAlign: "center",
  },
});
