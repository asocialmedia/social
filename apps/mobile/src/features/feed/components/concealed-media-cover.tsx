import { Image } from "expo-image";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

import {
  canBlurExplicitCover,
  explicitCoverUrl,
  supportsExplicitBlur,
} from "../lib/explicit-cover";
import type { FeedMedia } from "../lib/feed-types";

export function ConcealedMediaCover({
  apiBase,
  media,
}: {
  apiBase: string;
  media: FeedMedia;
}) {
  const { theme } = useAppTheme();
  const uri = explicitCoverUrl(apiBase, media);
  const [staticUri, setStaticUri] = useState<string | null>(null);
  const supported = supportsExplicitBlur(Platform.OS, Platform.Version);
  const viewBlur = Platform.OS === "android" && supported;
  const ready = supported && Boolean(uri) && staticUri === uri;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.containerBg }]}
    >
      {uri && supported ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { opacity: ready ? 0.6 : 0 },
            viewBlur ? { filter: [{ blur: 24 }] } : null,
          ]}
        >
          <Image
            accessibilityLabel=""
            autoplay={false}
            blurRadius={viewBlur ? 0 : 40}
            cachePolicy="memory-disk"
            contentFit="cover"
            onLoad={(event) =>
              setStaticUri(
                viewBlur || canBlurExplicitCover(event.source) ? uri : null
              )
            }
            source={{ uri }}
            style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.05 }] }]}
          />
        </View>
      ) : null}
    </View>
  );
}
