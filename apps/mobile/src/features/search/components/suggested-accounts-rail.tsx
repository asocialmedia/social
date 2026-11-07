// Native port of web Spotlight's SuggestedAccountsRail, SuggestedAccountCard
// and SuggestedCardBanner: a horizontal rail of w-40 cards with a banner (or a
// seeded wash), the avatar cut into it, name, handle, bio and a follow pill.
// The edge arrows appear only while the rail can scroll, as on web.
import type { RecommendedAccount } from "@asm/protocols/discovery";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useRef, useState } from "react";
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewInstance,
} from "react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { iconButton } from "@/components/surface/recipes";
import { BlueskyIcon } from "@/features/feed/components/bluesky-icon";
import { getApiBaseUrl } from "@/lib/network/api-env";

import type { SpotlightResultItem } from "../lib/spotlight-items";
import { bannerWash, cardSurface } from "./spotlight-recipes";
import type { SpotlightPalette } from "./spotlight-recipes";
import { BLUESKY_MARK, GroupHeader } from "./spotlight-rows";
import { SuggestedFollowButton } from "./suggested-follow-button";

const CARD_WIDTH = 160;
const CARD_GAP = 8;

function bannerSource(url: string): string {
  return url.startsWith("/") ? `${getApiBaseUrl()}${url}` : url;
}

function CardBanner({
  bannerUrl,
  blue,
  seed,
  surface,
}: {
  bannerUrl: string | null;
  blue: boolean;
  seed: string;
  surface: string;
}) {
  const [failed, setFailed] = useState(false);
  const fade = (
    <LinearGradient
      colors={["transparent", surface]}
      pointerEvents="none"
      style={styles.bannerFade}
    />
  );
  if (bannerUrl && !failed) {
    return (
      <View style={styles.banner}>
        <Image
          contentFit="cover"
          onError={() => setFailed(true)}
          source={{ uri: bannerSource(bannerUrl) }}
          style={StyleSheet.absoluteFill}
        />
        {fade}
      </View>
    );
  }
  return (
    <View style={[styles.banner, blue ? styles.bannerWashBlue : null]}>
      <LinearGradient
        colors={bannerWash(seed)}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {fade}
    </View>
  );
}

function fallbackAccount(item: SpotlightResultItem): RecommendedAccount {
  const source = item.source ?? "asm";
  return {
    avatarUrl: item.avatarUrl ?? null,
    displayName: item.displayName,
    followers: 0,
    following: false,
    handle: item.subtitle?.replace(/^@/, "") ?? item.displayName,
    href: item.href,
    id: item.id.slice(`${source}-user-`.length),
    reason: item.reason ?? "Based on your searches",
    source,
  };
}

function SuggestedAccountCard({
  isDark,
  item,
  onAuthRedirect,
  onSelect,
  palette,
}: {
  isDark: boolean;
  item: SpotlightResultItem;
  onAuthRedirect: () => void;
  onSelect: () => void;
  palette: SpotlightPalette;
}) {
  const surface = cardSurface(isDark, palette.blue);
  const solidSurface = isDark ? "#171717" : "#f3f4f6";
  const account = item.recommendedAccount;
  const bio = account?.bio?.replaceAll(/\s+/g, " ").trim() || null;
  // `text-foreground/70`, or `text-white/80` on the Bluesky surface.
  let bioColor = isDark ? "rgba(238, 238, 238, 0.7)" : "rgba(32, 32, 32, 0.7)";
  if (palette.blue) {
    bioColor = "rgba(255, 255, 255, 0.8)";
  }
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: surface.background,
          borderColor: surface.border,
          boxShadow: surface.shadows,
        },
      ]}
    >
      <Pressable
        accessibilityLabel={`${item.displayName} ${item.subtitle ?? ""}`}
        accessibilityRole="button"
        onPress={onSelect}
        style={({ pressed }) => [
          styles.cardBody,
          pressed ? { backgroundColor: palette.rowPressed } : null,
        ]}
      >
        <CardBanner
          bannerUrl={account?.bannerUrl ?? null}
          blue={palette.blue}
          seed={item.id}
          surface={palette.blue ? surface.background : solidSurface}
        />
        <View style={styles.avatarSlot}>
          <View
            style={[
              styles.avatarRing,
              palette.blue
                ? styles.avatarShadow
                : { borderColor: solidSurface, borderWidth: 3 },
            ]}
          >
            <UserAvatar
              radius={16}
              seed={item.id}
              size={44}
              url={item.avatarUrl}
            />
          </View>
        </View>
        <View style={styles.nameLine}>
          <Text
            numberOfLines={1}
            style={[styles.name, { color: palette.foreground }]}
          >
            {item.displayName}
          </Text>
          {item.source === "bluesky" ? (
            <BlueskyIcon
              color={palette.blue ? "#ffffff" : BLUESKY_MARK}
              size={12}
            />
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={[
            styles.handle,
            {
              color: palette.blue ? "rgba(255, 255, 255, 0.75)" : palette.muted,
            },
          ]}
        >
          {item.subtitle}
        </Text>
        <Text numberOfLines={2} style={[styles.bio, { color: bioColor }]}>
          {bio ?? item.reason ?? "Suggested for you"}
        </Text>
      </Pressable>
      <View style={styles.follow}>
        <SuggestedFollowButton
          account={account ?? fallbackAccount(item)}
          blue={palette.blue}
          onAuthRedirect={onAuthRedirect}
        />
      </View>
    </View>
  );
}

function RailArrow({
  direction,
  disabled,
  isDark,
  onPress,
  palette,
}: {
  direction: "left" | "right";
  disabled: boolean;
  isDark: boolean;
  onPress: () => void;
  palette: SpotlightPalette;
}) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  const recipe = iconButton(isDark);
  return (
    <Pressable
      accessibilityLabel={direction === "left" ? "Scroll left" : "Scroll right"}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.arrow,
        palette.blue
          ? styles.arrowBlue
          : { backgroundColor: recipe.background, boxShadow: recipe.shadows },
        disabled ? styles.arrowDisabled : null,
      ]}
    >
      <Icon color={palette.blue ? "#ffffff" : recipe.color} size={14} />
    </Pressable>
  );
}

export function SuggestedAccountsRail({
  aside,
  isDark,
  items,
  onAuthRedirect,
  onSelect,
  palette,
}: {
  aside: string;
  isDark: boolean;
  items: SpotlightResultItem[];
  onAuthRedirect: () => void;
  onSelect: (item: SpotlightResultItem) => void;
  palette: SpotlightPalette;
}) {
  const railRef = useRef<ScrollViewInstance>(null);
  const [metrics, setMetrics] = useState({ content: 0, offset: 0, width: 0 });
  // The same 8px slop web uses, so a snapped first card does not read as
  // "already scrolled" and show a back arrow on first paint.
  const max = metrics.content - metrics.width;
  const edges = { end: metrics.offset < max - 8, start: metrics.offset > 8 };
  const scrollable = edges.start || edges.end;
  const nudge = (direction: -1 | 1) => {
    const step = Math.max(160, metrics.width * 0.8);
    railRef.current?.scrollTo({
      animated: true,
      x: Math.min(
        Math.max(0, metrics.offset + direction * step),
        Math.max(0, max)
      ),
    });
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.x;
    setMetrics((current) =>
      current.offset === offset ? current : { ...current, offset }
    );
  };
  return (
    <>
      <GroupHeader
        aside={aside}
        palette={palette}
        title="Suggested accounts"
        trailing={
          scrollable ? (
            <View style={styles.arrows}>
              <RailArrow
                direction="left"
                disabled={!edges.start}
                isDark={isDark}
                onPress={() => nudge(-1)}
                palette={palette}
              />
              <RailArrow
                direction="right"
                disabled={!edges.end}
                isDark={isDark}
                onPress={() => nudge(1)}
                palette={palette}
              />
            </View>
          ) : null
        }
      />
      <ScrollView
        contentContainerStyle={styles.railContent}
        decelerationRate="fast"
        horizontal
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(content) =>
          setMetrics((current) =>
            current.content === content ? current : { ...current, content }
          )
        }
        onLayout={(event) => {
          const { width } = event.nativeEvent.layout;
          setMetrics((current) =>
            current.width === width ? current : { ...current, width }
          );
        }}
        onScroll={onScroll}
        ref={railRef}
        scrollEventThrottle={32}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="start"
      >
        {items.map((item) => (
          <SuggestedAccountCard
            isDark={isDark}
            item={item}
            key={item.id}
            onAuthRedirect={onAuthRedirect}
            onSelect={() => onSelect(item)}
            palette={palette}
          />
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  arrow: {
    alignItems: "center",
    borderRadius: 6,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  arrowBlue: {
    backgroundColor: "#0866df",
    borderColor: "rgba(255, 255, 255, 0.4)",
    borderWidth: 1,
  },
  arrowDisabled: {
    opacity: 0.4,
  },
  arrows: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  avatarRing: {
    alignSelf: "flex-start",
    borderRadius: 19,
  },
  avatarShadow: {
    borderRadius: 16,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  avatarSlot: {
    marginTop: -24,
    paddingHorizontal: 12,
    zIndex: 1,
  },
  banner: {
    height: 56,
    overflow: "hidden",
    width: "100%",
  },
  bannerFade: {
    bottom: 0,
    height: 36,
    left: 0,
    position: "absolute",
    right: 0,
  },
  bannerWashBlue: {
    opacity: 0.6,
  },
  bio: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 6,
    minHeight: 28,
    paddingHorizontal: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    width: CARD_WIDTH,
  },
  cardBody: {
    flex: 1,
  },
  follow: {
    marginTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  handle: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    marginTop: 2,
    paddingHorizontal: 12,
  },
  name: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 13,
    lineHeight: 16,
  },
  nameLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 12,
  },
  railContent: {
    gap: CARD_GAP,
    paddingBottom: 4,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
});
