// The hashtag screen, a port of web's `components/posts/views/hashtag-feed-page.tsx`.
//
// Web's page is the top bar, a header row of three columns (back link, the
// centred `#tag` title with its orange underline, and the FeedSourceMenu),
// then the merged feed. Web also server-renders JSON-LD and redirects a
// non-canonical tag casing; neither has meaning in a native client.
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { IconButton3D } from "@/components/surface/icon-button-3d";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedSourceMenu } from "@/features/feed/components/feed-source-menu";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { useAppTheme } from "@/theme";

import { canonicalTag } from "../lib/hashtag-api";
import { HashtagFeed } from "./hashtag-feed";

// Web's `grid-cols-[2.75rem_minmax(0,1fr)_2.75rem]`: equal side columns keep
// the title on the screen's centreline whatever sits beside it.
const SIDE_COLUMN = 44;
const UNDERLINE_GRADIENT = ["#ff9500", "#e65500"] as const;

export function HashtagScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { user } = useSessionContext();
  const params = useLocalSearchParams<{ tag?: string | string[] }>();
  const raw = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const tag = canonicalTag(raw ?? "");

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        hideOnScroll={false}
        user={
          user
            ? {
                id: user.id,
                image: user.image,
                username: user.username ?? user.name,
              }
            : null
        }
      />
      {tag ? (
        <>
          <View
            style={[
              styles.titleRow,
              {
                backgroundColor: theme.containerBg,
                borderBottomColor: theme.cardBorder,
              },
            ]}
          >
            <View style={styles.side}>
              <IconButton3D
                accessibilityLabel="Go back"
                icon={ArrowLeft}
                onPress={goBack}
                size={32}
              />
            </View>
            <View style={styles.title}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[styles.titleText, { color: theme.inputText }]}
              >
                #{tag}
              </Text>
              <View style={styles.underlineWrap}>
                <LinearGradient
                  colors={UNDERLINE_GRADIENT}
                  style={styles.underline}
                />
              </View>
            </View>
            <View style={styles.side}>
              <FeedSourceMenu following={false} />
            </View>
          </View>
          {/* Keyed by tag like web, so a new tag never shows the old one's pages. */}
          <HashtagFeed key={tag} tag={tag} />
        </>
      ) : (
        // A tag that does not normalise cannot be requested from either source.
        <View style={styles.center}>
          <Text style={[styles.body, { color: theme.dividerText }]}>
            That hashtag looks incomplete
          </Text>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={goBack}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Go back</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  center: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    padding: 24,
  },
  retry: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 13 },
  root: { flex: 1 },
  side: {
    alignItems: "center",
    justifyContent: "center",
    width: SIDE_COLUMN,
  },
  // `relative min-w-0 px-3 py-3 text-center`.
  title: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  titleRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingVertical: 6,
  },
  titleText: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    textAlign: "center",
  },
  // `h-1 w-6 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]`.
  underline: { borderRadius: 2, height: 4, width: 24 },
  underlineWrap: {
    alignItems: "center",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
  },
});
