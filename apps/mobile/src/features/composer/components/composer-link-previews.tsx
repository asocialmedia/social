// Live link previews inside the post composer, port of web's
// link-embed-composer.tsx: as the author types a link, the server-resolved
// embed (title, thumbnail, or a YouTube card) appears below with a dismiss
// button - dismissed links are excluded from the published post's stored
// embeds via dismissedEmbedUrls. Resolution runs server-side behind the SSRF
// guard; this component only renders the resolver's validated payload.
import { Link2, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { IconButton3D } from "@/components/surface/icon-button-3d";
import { MAX_POST_EMBEDS } from "@/features/feed/lib/link-embeds";
import { extractPostUrls } from "@/features/feed/lib/link-preview-resolver";
import { useLinkPreviews } from "@/features/feed/lib/use-link-previews";
import { useAppTheme } from "@/theme";

// How long typing must settle before a link preview fires. The resolver
// caches, so the debounce only spares the pipeline redundant lookups for URLs
// the author is still writing.
const LINK_PREVIEW_DEBOUNCE_MS = 700;

export function ComposerLinkPreviews({
  content,
  dismissedUrls,
  onDismiss,
}: {
  // The composer's current plain text; URLs are re-extracted on change.
  content: string;
  dismissedUrls: readonly string[];
  onDismiss: (url: string) => void;
}) {
  const { theme } = useAppTheme();
  const [debounced, setDebounced] = useState(content);
  useEffect(() => {
    const timer = setTimeout(
      () => setDebounced(content),
      LINK_PREVIEW_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [content]);
  const { embeds, loading } = useLinkPreviews(debounced);
  const currentUrls = extractPostUrls(content);
  const urls = extractPostUrls(debounced)
    .filter((url) => currentUrls.includes(url) && !dismissedUrls.includes(url))
    .slice(0, MAX_POST_EMBEDS);

  if (urls.length === 0) {
    return null;
  }

  return (
    <View style={styles.list}>
      {urls.map((url) => {
        const embed = embeds.find((item) => item.url === url);
        const isYoutube = embed?.type === "youtube" && embed.videoId;
        return (
          <View
            key={url}
            style={[
              styles.card,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <View style={styles.head}>
              <Link2 color={theme.dividerText} size={15} />
              <Text
                numberOfLines={1}
                style={[styles.site, { color: theme.dividerText }]}
              >
                {embed?.siteName ?? (loading ? "Resolving link…" : "Link")}
              </Text>
              <IconButton3D
                accessibilityLabel={`Dismiss preview for ${url}`}
                icon={X}
                iconSize={12}
                onPress={() => onDismiss(url)}
                size={24}
              />
            </View>
            {embed?.title ? (
              <Text
                numberOfLines={2}
                style={[styles.title, { color: theme.inputText }]}
              >
                {embed.title}
              </Text>
            ) : null}
            {embed?.description ? (
              <Text
                numberOfLines={2}
                style={[styles.description, { color: theme.dividerText }]}
              >
                {embed.description}
              </Text>
            ) : null}
            {isYoutube ? (
              <Text style={[styles.note, { color: theme.dividerText }]}>
                YouTube player will be attached to this post
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    marginTop: 2,
  },
  head: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  list: {
    gap: 8,
    marginTop: 12,
  },
  note: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    marginTop: 4,
  },
  site: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    minWidth: 0,
  },
  title: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    marginTop: 6,
  },
});
