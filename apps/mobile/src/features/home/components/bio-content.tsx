// Bio renderer for the profile popup: web's PostInlineContent in chip mode
// (post-inline-content.tsx with linkBadge="chip"). URLs become link pills
// (platform glyph or host-initial tile + host label), @mentions become
// mention pills with an avatar, #tags become tag pills.
//
// React Native cannot nest Views inside flowing Text, so segments lay out in
// a wrapping row (the standard native linkify arrangement) instead of true
// inline flow. Mention/tag pills are static: their profile/hashtag screens
// do not exist on mobile yet, same as the popup's other disabled stubs.
import { FontAwesome6 } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { Hash } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { authClient } from "@/features/auth/lib/auth-client";
import {
  META_CHIP_SHADOWS,
  META_CHIP_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import { popupCache } from "./profile-cache";
import { fetchLinkPreview } from "./profile-data";
import type { BioSegment } from "./profile-utils";
import {
  clampBioSegments,
  getLinkPlatform,
  hostLabel,
  safeLinkUrl,
  segmentBioContent,
} from "./profile-utils";

// At most this many pills per bio resolve a preview title (web caps inline
// previews the same way); the rest keep their host label.
const MAX_PREVIEW_PILLS = 5;

function ChipShell({ children, tint }: { children: ReactNode; tint?: string }) {
  const { isDark, theme } = useAppTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: tint ?? theme.containerBg,
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.12)"
            : "rgba(0, 0, 0, 0.1)",
          boxShadow: isDark ? META_CHIP_SHADOWS_DARK : META_CHIP_SHADOWS,
        },
      ]}
    >
      {children}
    </View>
  );
}

function LinkChip({ title, url }: { title?: string; url: string }) {
  const { isDark, theme } = useAppTheme();
  const platform = getLinkPlatform(url);
  const label = title?.trim() || hostLabel(url);
  const iconColor = platform?.color ?? theme.dividerText;
  return (
    <Pressable
      accessibilityLabel={`${label}, ${url}`}
      accessibilityRole="link"
      onPress={() => {
        const safe = safeLinkUrl(url);
        if (safe) {
          void Linking.openURL(safe);
        }
      }}
    >
      <ChipShell>
        {platform ? (
          <FontAwesome6 color={iconColor} name={platform.icon} size={14} />
        ) : (
          <View
            style={[
              styles.initialTile,
              {
                backgroundColor: isDark
                  ? "rgba(255, 255, 255, 0.08)"
                  : theme.dividerLine,
              },
            ]}
          >
            <Text style={[styles.initialText, { color: theme.dividerText }]}>
              {(label[0] ?? "L").toUpperCase()}
            </Text>
          </View>
        )}
        <Text
          numberOfLines={1}
          style={[styles.chipText, { color: theme.dividerText }]}
        >
          {label}
        </Text>
      </ChipShell>
    </Pressable>
  );
}

export function MentionChip({
  avatarUrl,
  username,
}: {
  avatarUrl?: string | null;
  username: string;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View
      accessibilityLabel={`Mentioned user ${username}`}
      accessibilityRole="text"
    >
      <ChipShell
        tint={isDark ? "rgba(59, 130, 246, 0.12)" : "rgba(59, 130, 246, 0.08)"}
      >
        <Image
          contentFit="cover"
          source={avatarUrl ? { uri: avatarUrl } : avatarPlaceholder}
          style={styles.mentionAvatar}
        />
        <Text
          numberOfLines={1}
          style={[styles.chipText, { color: theme.dividerText }]}
        >
          @{username}
        </Text>
      </ChipShell>
    </View>
  );
}

export function TagChip({ tag }: { tag: string }) {
  const { isDark, theme } = useAppTheme();
  return (
    <View accessibilityLabel={`Hashtag ${tag}`} accessibilityRole="text">
      <ChipShell
        tint={isDark ? "rgba(255, 149, 0, 0.12)" : "rgba(255, 149, 0, 0.1)"}
      >
        <Hash color={theme.dividerText} size={14} />
        <Text
          numberOfLines={1}
          style={[styles.chipText, { color: theme.dividerText }]}
        >
          {tag}
        </Text>
      </ChipShell>
    </View>
  );
}

function BioPiece({
  segment,
  titles,
}: {
  segment: BioSegment;
  titles: Record<string, string>;
}) {
  const { theme } = useAppTheme();
  switch (segment.type) {
    case "url": {
      return <LinkChip title={titles[segment.url]} url={segment.url} />;
    }
    case "mention": {
      return <MentionChip username={segment.username} />;
    }
    case "tag": {
      return <TagChip tag={segment.tag} />;
    }
    default: {
      return (
        <Text style={[styles.text, { color: theme.inputText }]}>
          {segment.text}
        </Text>
      );
    }
  }
}

export function BioContent({
  apiBase,
  bio,
  clampLength,
}: {
  apiBase: string;
  bio: string;
  // Long bodies collapse behind Show more/less, mirroring web's ~6-line
  // clamp. Cutting happens at segment boundaries so pills never split.
  clampLength?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { theme } = useAppTheme();
  const full = useMemo(() => segmentBioContent(bio), [bio]);
  const { clamped, visible: segments } = useMemo(() => {
    if (clampLength === undefined || expanded || bio.length <= clampLength) {
      return { clamped: false, visible: full };
    }
    return clampBioSegments(full, clampLength);
  }, [bio, clampLength, expanded, full]);
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    const urls: string[] = [];
    for (const segment of full) {
      if (segment.type === "url" && !urls.includes(segment.url)) {
        urls.push(segment.url);
      }
    }
    const wanted = urls.slice(0, MAX_PREVIEW_PILLS);
    if (wanted.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const cookie = await authClient.getCookie();
      const shared = { apiBase, cookie };
      const cached: Record<string, string> = {};
      const missing: string[] = [];
      for (const url of wanted) {
        const hit = popupCache.getFreshLinkPreview(url);
        if (hit) {
          cached[url] = hit.title;
        } else {
          missing.push(url);
        }
      }
      if (!cancelled && Object.keys(cached).length > 0) {
        // oxlint-disable-next-line react/set-state-in-effect -- cached titles paint instantly; the fetches below refresh the rest
        setTitles(cached);
      }
      for (const url of missing) {
        // eslint-disable-next-line no-await-in-loop -- previews resolve one at a time to bound concurrent network use
        const preview = await fetchLinkPreview(url, shared).catch(() => null);
        if (preview) {
          popupCache.setLinkPreview(url, preview);
          if (!cancelled) {
            // oxlint-disable-next-line react/set-state-in-effect -- each resolved title upgrades its pill as it lands
            setTitles((previous) => ({ ...previous, [url]: preview.title }));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, full]);

  return (
    <View>
      <View style={styles.wrap}>
        {segments.map((segment, index) => (
          // Index keys are safe: segments derive deterministically from the
          // immutable bio string, so order never shuffles under a render.
          <BioPiece
            key={`${segment.type}-${index}`}
            segment={segment}
            titles={titles}
          />
        ))}
      </View>
      {clampLength !== undefined && (clamped || expanded) ? (
        <Pressable hitSlop={4} onPress={() => setExpanded((value) => !value)}>
          <Text style={[styles.expand, { color: theme.auxLink }]}>
            {expanded ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
  },
  chipText: {
    flexShrink: 1,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    maxWidth: 224,
  },
  expand: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    marginTop: 4,
  },
  initialText: {
    fontFamily: "SofiaProBold",
    fontSize: 8,
    fontWeight: "normal",
  },
  initialTile: {
    alignItems: "center",
    borderRadius: 2,
    height: 14,
    justifyContent: "center",
    width: 14,
  },
  mentionAvatar: {
    borderRadius: 9999,
    height: 16,
    width: 16,
  },
  text: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    textAlignVertical: "center",
  },
  wrap: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
  },
});
