// Link preview cards below post content, ported from web's posts/embeds
// suite (PostLinkEmbeds + YouTubeEmbed + EmbedCard). Payloads arrive
// pre-validated (see lib/link-embeds); thumbnails always go through the
// SSRF-guarded proxy rooted at the API base. Taps open the origin URL
// externally: mobile has no iframe player, so the YouTube facade links out
// instead of swapping in a youtube-nocookie player.
import { FontAwesome6 } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { Play } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

import {
  getLinkPlatform,
  hostLabel,
  safeLinkUrl,
} from "../../home/components/profile-utils";
import type { LinkEmbed } from "../lib/link-embeds";
import { embedImageUrl, youtubeEmbedThumbnail } from "../lib/link-embeds";

// `.embed-panel-3d` panel recipe, light + dark.
const EMBED_PANEL_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.8), inset 0 -1px 2px rgba(0, 0, 0, 0.03), 0 1px 2px rgba(0, 0, 0, 0.05), 0 3px 8px rgba(0, 0, 0, 0.06)";
const EMBED_PANEL_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.06), inset 0 -1px 2px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.18), 0 3px 8px rgba(0, 0, 0, 0.15)";

function openEmbedUrl(url: string): void {
  const safe = safeLinkUrl(url);
  if (safe) {
    void Linking.openURL(safe);
  }
}

function panelStyle(isDark: boolean, cardBg: string) {
  return {
    backgroundColor: cardBg,
    borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
    borderWidth: 1,
    boxShadow: isDark ? EMBED_PANEL_SHADOWS_DARK : EMBED_PANEL_SHADOWS,
  };
}

// Platform-aware origin badge: brand glyph for known platforms, otherwise
// a host-initial tile. No favicon fetch, like web's EmbedSiteBadge.
function EmbedSiteBadge({
  siteName,
  url,
}: {
  siteName: string | null | undefined;
  url: string;
}) {
  const { theme } = useAppTheme();
  const platform = getLinkPlatform(url);
  if (platform) {
    return (
      <View style={[styles.badgeTile, { backgroundColor: theme.dividerLine }]}>
        <FontAwesome6
          color={platform.color ?? theme.dividerText}
          name={platform.icon}
          size={12}
        />
      </View>
    );
  }
  const label = hostLabel(url) || siteName || "link";
  return (
    <View style={[styles.badgeTile, { backgroundColor: theme.dividerLine }]}>
      <Text style={[styles.badgeLetter, { color: theme.dividerText }]}>
        {(label[0] ?? "L").toUpperCase()}
      </Text>
    </View>
  );
}

function YouTubeFacade({
  apiBase,
  embed,
}: {
  apiBase: string;
  embed: LinkEmbed;
}) {
  const { isDark, theme } = useAppTheme();
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbnail = youtubeEmbedThumbnail(embed.videoId);
  if (!thumbnail) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel={`Open video: ${embed.title}`}
      accessibilityRole="link"
      onPress={() => openEmbedUrl(embed.url)}
      style={[styles.panel, panelStyle(isDark, theme.cardBg)]}
    >
      <View style={styles.ytHead}>
        <View style={styles.ytBadge}>
          <Play color="#ffffff" fill="#ffffff" size={8} />
        </View>
        <Text
          numberOfLines={1}
          style={[styles.siteName, { color: theme.dividerText }]}
        >
          {embed.videoAuthor ?? embed.siteName ?? "YouTube"}
        </Text>
      </View>
      <View style={styles.ytThumbWrap}>
        {thumbFailed ? null : (
          <Image
            accessibilityLabel=""
            contentFit="cover"
            onError={() => setThumbFailed(true)}
            source={{ uri: embedImageUrl(apiBase, thumbnail) }}
            style={styles.ytThumb}
          />
        )}
        <View pointerEvents="none" style={styles.ytScrim} />
        <View style={styles.ytPlay}>
          <Play
            color="#ffffff"
            fill="#ffffff"
            size={22}
            style={styles.playNudge}
          />
        </View>
      </View>
      <Text
        numberOfLines={2}
        style={[styles.ytTitle, { color: theme.inputText }]}
      >
        {embed.title}
      </Text>
    </Pressable>
  );
}

function OgCard({ apiBase, embed }: { apiBase: string; embed: LinkEmbed }) {
  const { isDark, theme } = useAppTheme();
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = embed.imageUrl && !thumbFailed;
  return (
    <Pressable
      accessibilityLabel={`Open link: ${embed.title}`}
      accessibilityRole="link"
      onPress={() => openEmbedUrl(embed.url)}
      style={[styles.panel, panelStyle(isDark, theme.cardBg)]}
    >
      <View style={styles.ogRow}>
        <View style={styles.ogBody}>
          <View style={styles.ogHead}>
            <EmbedSiteBadge siteName={embed.siteName} url={embed.url} />
            <Text
              numberOfLines={1}
              style={[styles.siteName, { color: theme.dividerText }]}
            >
              {embed.siteName ?? "Link"}
            </Text>
          </View>
          <Text
            numberOfLines={2}
            style={[styles.ogTitle, { color: theme.inputText }]}
          >
            {embed.title}
          </Text>
          {embed.description ? (
            <Text
              numberOfLines={2}
              style={[styles.ogDesc, { color: theme.dividerText }]}
            >
              {embed.description}
            </Text>
          ) : null}
        </View>
        {showThumb ? (
          <Image
            accessibilityLabel=""
            contentFit="cover"
            onError={() => setThumbFailed(true)}
            source={{ uri: embedImageUrl(apiBase, embed.imageUrl ?? "") }}
            style={styles.ogThumb}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export function PostLinkEmbeds({
  apiBase,
  embeds,
}: {
  apiBase: string;
  embeds: LinkEmbed[];
}) {
  if (embeds.length === 0) {
    return null;
  }
  return (
    <View style={styles.column}>
      {embeds
        .slice(0, 5)
        .map((embed) =>
          embed.type === "youtube" && embed.videoId ? (
            <YouTubeFacade apiBase={apiBase} embed={embed} key={embed.url} />
          ) : (
            <OgCard apiBase={apiBase} embed={embed} key={embed.url} />
          )
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeLetter: {
    fontFamily: "SofiaProBold",
    fontSize: 9,
    fontWeight: "normal",
  },
  badgeTile: {
    alignItems: "center",
    borderRadius: 2,
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  column: {
    gap: 8,
  },
  ogBody: {
    flex: 1,
    minWidth: 0,
  },
  ogDesc: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 2,
  },
  ogHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  ogRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  ogThumb: {
    borderRadius: 8,
    height: 80,
    width: 80,
  },
  ogTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 18,
    marginTop: 4,
  },
  panel: {
    borderRadius: 14,
    overflow: "hidden",
  },
  playNudge: {
    marginLeft: 2,
  },
  siteName: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    minWidth: 0,
  },
  ytBadge: {
    alignItems: "center",
    backgroundColor: "#ff0000",
    borderRadius: 2,
    height: 16,
    justifyContent: "center",
    width: 24,
  },
  ytHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  ytPlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 9999,
    height: 56,
    justifyContent: "center",
    left: "50%",
    marginLeft: -28,
    marginTop: -28,
    position: "absolute",
    top: "50%",
    width: 56,
  },
  ytScrim: {
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  ytThumb: {
    height: "100%",
    width: "100%",
  },
  ytThumbWrap: {
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    position: "relative",
    width: "100%",
  },
  ytTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
