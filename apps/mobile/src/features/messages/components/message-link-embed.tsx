import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

import { PostLinkEmbeds } from "@/features/feed/components/post-link-embeds";
import type { LinkEmbed } from "@/features/feed/lib/link-embeds";
import {
  createLinkPreviewResolver,
  extractPostUrls,
} from "@/features/feed/lib/link-preview-resolver";
import {
  hostnameOf,
  postIdFromUrl,
  splitMessageText,
  youtubeVideoIdFromUrl,
} from "@/features/messages/lib/message-links";
// The first link in a text bubble, resolved into a preview card, plus the body
// text with its links made tappable.
//
// Ported from apps/web/src/components/messages/message-link-embed.tsx. The body
// is decrypted on the device; only the URL goes to the same rate-limited,
// SSRF-guarded /api/link-preview route the feed uses. An internal post link
// renders as the in-app post card, a YouTube link keeps its facade while the
// metadata loads, and a failed preview falls back to a plain host card.
import { openExternalUrl } from "@/lib/interaction/open-url";
import { logInfo, logWarn } from "@/lib/lifecycle/telemetry";
import { PROD_API_URL } from "@/lib/network/api-base";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { MessagePostPreview } from "./message-post-preview";

let resolver: ReturnType<typeof createLinkPreviewResolver> | null = null;
let resolverBase = "";

function sharedResolver() {
  const apiBase = getApiBaseUrl();
  if (!resolver || resolverBase !== apiBase) {
    resolver = createLinkPreviewResolver({
      apiBase,
      log: { info: logInfo, warn: logWarn },
    });
    resolverBase = apiBase;
  }
  return resolver;
}

// `undefined` while resolving, `null` when the preview resolved to nothing.
function useLinkPreview(url: string, enabled: boolean) {
  const [result, setResult] = useState<{
    embed: LinkEmbed | null;
    url: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !url) {
      return;
    }
    let active = true;
    void (async () => {
      const embed = await sharedResolver().load(url);
      if (active) {
        setResult({ embed, url });
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled, url]);
  return result?.url === url ? result.embed : undefined;
}

export function MessageLinkEmbed({
  content,
  mine,
  width,
}: {
  content: string;
  mine: boolean;
  // The bubble's inner width, so a short message still gets a full card.
  width?: number;
}) {
  const sized = width ? { width } : null;
  const url = useMemo(() => extractPostUrls(content)[0] ?? "", [content]);
  const internalPostId = url
    ? postIdFromUrl(url, [getApiBaseUrl(), PROD_API_URL])
    : null;
  const videoId = url ? youtubeVideoIdFromUrl(url) : null;
  const preview = useLinkPreview(url, Boolean(url) && !internalPostId);
  const { isDark } = useAppTheme();
  if (!url) {
    return null;
  }
  if (internalPostId) {
    return (
      <View style={[styles.wrap, sized]}>
        <MessagePostPreview key={internalPostId} postId={internalPostId} />
      </View>
    );
  }
  const apiBase = getApiBaseUrl();
  if (videoId) {
    return (
      <View style={[styles.wrap, sized]}>
        <PostLinkEmbeds
          apiBase={apiBase}
          embeds={[
            preview ?? {
              siteName: "YouTube",
              title: url,
              type: "youtube",
              url,
              videoId,
            },
          ]}
        />
      </View>
    );
  }
  if (preview === undefined) {
    // A fixed-height skeleton (`h-28`), so the card landing does not grow the
    // bubble and shift the inverted transcript mid-scroll.
    let ink = isDark ? "#eeeeee" : "#202020";
    if (mine) {
      ink = "#ffffff";
    }
    return (
      <View
        accessibilityLabel="Loading link preview"
        style={[
          styles.skeleton,
          sized,
          {
            backgroundColor: isDark ? "#1c1c1c" : "#ffffff",
            borderColor: isDark
              ? "rgba(255, 255, 255, 0.12)"
              : "rgba(0, 0, 0, 0.12)",
          },
        ]}
      >
        <View style={styles.skeletonLines}>
          <View style={[styles.bar, { backgroundColor: ink, width: "33%" }]} />
          <View
            style={[styles.barTall, { backgroundColor: ink, width: "75%" }]}
          />
          <View
            style={[
              styles.bar,
              { backgroundColor: ink, opacity: 0.15, width: "66%" },
            ]}
          />
        </View>
        <View style={[styles.thumb, { backgroundColor: ink }]} />
      </View>
    );
  }
  return (
    <View style={[styles.wrap, sized]}>
      <PostLinkEmbeds
        apiBase={apiBase}
        embeds={[
          preview ?? {
            siteName: hostnameOf(url),
            title: url,
            type: "link",
            url,
          },
        ]}
      />
    </View>
  );
}

// The body text with every URL tappable, like web's inline LinkBadge runs.
export function LinkifiedMessageText({
  content,
  linkStyle,
  style,
}: {
  content: string;
  linkStyle?: StyleProp<TextStyle>;
  style: StyleProp<TextStyle>;
}) {
  const segments = useMemo(() => splitMessageText(content), [content]);
  if (!segments.some((segment) => segment.kind === "link")) {
    return <Text style={style}>{content}</Text>;
  }
  return (
    <Text style={style}>
      {segments.map((segment, index) =>
        segment.kind === "link" ? (
          <Text
            accessibilityRole="link"
            key={`${index}:${segment.url}`}
            onPress={() => {
              void openExternalUrl(segment.url);
            }}
            style={[styles.link, linkStyle]}
          >
            {segment.text}
          </Text>
        ) : (
          segment.text
        )
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 4, height: 12, opacity: 0.2 },
  barTall: { borderRadius: 4, height: 14, opacity: 0.2 },
  link: { textDecorationLine: "underline" },
  // `embed-panel-3d mt-1.5 flex h-28 w-full items-center gap-3 p-3`.
  skeleton: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    height: 112,
    marginTop: 6,
    padding: 12,
    width: "100%",
  },
  skeletonLines: { flex: 1, gap: 8 },
  thumb: { borderRadius: 8, height: 80, opacity: 0.15, width: 80 },
  wrap: { marginTop: 6, maxWidth: "100%", minWidth: 0 },
});
