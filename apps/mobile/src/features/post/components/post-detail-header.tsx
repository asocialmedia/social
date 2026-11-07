// Native port of the post page header in web's client-post.tsx: a 32px
// `icon-btn-3d` back button, a truncated 16px semibold title with a 12px
// muted subtitle, `px-3 py-2 gap-2.5` with a hairline bottom border, and the
// author's banner washed into the panel surface behind it (HeaderBannerWash).
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton3D } from "@/components/surface/icon-button-3d";
import { imageCachePolicy } from "@/lib/cache/image-cache";
import { useAppTheme } from "@/theme";

// hsl(var(--background-alt)) with an alpha, from the theme's hex.
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) {
    return hex;
  }
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function HeaderBannerWash({ bannerUrl }: { bannerUrl: string }) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return null;
  }
  const surface = theme.containerBg;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        blurRadius={2}
        cachePolicy={imageCachePolicy(bannerUrl)}
        contentFit="cover"
        contentPosition="left top"
        onError={() => setFailed(true)}
        source={{ uri: bannerUrl }}
        style={[StyleSheet.absoluteFill, styles.bannerImage]}
      />
      {/* Right-to-left: the panel surface where the text sits. */}
      <LinearGradient
        colors={["transparent", withAlpha(surface, 0.8), surface]}
        end={{ x: 1, y: 0.5 }}
        start={{ x: 0, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Bottom-up wash, pinning the visible image to the top-left corner. */}
      <LinearGradient
        colors={["transparent", withAlpha(surface, 0.55), surface]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function PostDetailHeader({
  bannerUrl,
  onBack,
  title = "Post",
  subtitle,
}: {
  bannerUrl?: string | null;
  onBack: () => void;
  title?: string;
  subtitle?: string | null;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top }}>
      <View style={[styles.bar, { borderBottomColor: theme.cardBorder }]}>
        {bannerUrl ? <HeaderBannerWash bannerUrl={bannerUrl} /> : null}
        <IconButton3D
          accessibilityLabel="Go back"
          icon={ArrowLeft}
          iconSize={16}
          onPress={onBack}
          size={32}
        />
        <View style={styles.titles}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: theme.inputText }]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={[styles.subtitle, { color: theme.dividerText }]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerImage: {
    transform: [{ scale: 1.05 }],
  },
  bar: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  subtitle: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 15,
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    lineHeight: 20,
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
});
