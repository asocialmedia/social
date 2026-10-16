// Small pieces the messages screens share, kept in one file because each is a few
// lines and they exist to make the screens read like the web components rather than
// like a list of inline style arrays.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BellOff, Check, CheckCheck } from "lucide-react-native";
import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import noMediaImage from "@/assets/images/nomedia.png";
import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import type { BubbleCorners } from "@/features/messages/lib/message-bubble-shape";
import {
  MESSAGE_IMAGE_CACHE_POLICY,
  messageImageSource,
} from "@/features/messages/lib/message-image-source";
import type { MessageReceipt } from "@/features/messages/lib/message-receipts";
import { receiptLabel } from "@/features/messages/lib/message-receipts";
import {
  bubbleReceived,
  chip3d,
  iconButton3d,
  pillHover,
  surface3d,
} from "@/features/messages/lib/message-recipes";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import { getApiBaseUrl } from "@/lib/api-env";
import { haptic } from "@/lib/haptics";
import { useAppTheme } from "@/theme";

// The destructive ink, or undefined for a default button.
function dangerInk(
  tone: "danger" | "default",
  isDark: boolean
): string | undefined {
  if (tone !== "danger") {
    return undefined;
  }
  return isDark ? "#ff8a80" : "#dc2626";
}

// A pressed icon button goes one step darker than its resting fill. Touch has no
// hover, so this is the moment web's hover recipe reads as.
function pressedFill(isDark: boolean): string {
  return isDark ? "#2a2a2a" : "#efefef";
}

// Pressed, a default icon button borrows the hover recipe's ink so the press reads
// as the same control getting attention rather than as a different control.
function iconColor(input: {
  danger: string | undefined;
  isDark: boolean;
  pressed: boolean;
  recipe: { color: string };
}): string {
  if (input.danger) {
    return input.danger;
  }
  if (!input.pressed) {
    return input.recipe.color;
  }
  return input.isDark ? "#ffffff" : "#1c1f26";
}

// A round icon button on the `.icon-btn-3d` recipe. Touch has no hover, so the
// pressed state borrows the hover recipe, which is the moment web's hover
// treatment reads as.
export function MessagesIconButton({
  icon: Icon,
  label,
  onPress,
  size = 34,
  tone = "default",
  disabled = false,
}: {
  icon: ComponentType<{ color?: string; size?: number }>;
  label: string;
  onPress: () => void;
  size?: number;
  tone?: "danger" | "default";
  disabled?: boolean;
}) {
  const { isDark } = useAppTheme();
  const recipe = iconButton3d(isDark);
  const dangerColor = dangerInk(tone, isDark);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        haptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: pressed ? pressedFill(isDark) : recipe.background,
          boxShadow: recipe.shadows,
          height: size,
          opacity: disabled ? 0.4 : 1,
          width: size,
        },
      ]}
    >
      {({ pressed }) => (
        <Icon
          color={iconColor({ danger: dangerColor, isDark, pressed, recipe })}
          size={Math.round(size * 0.5)}
        />
      )}
    </Pressable>
  );
}

// A row that takes the `.pill-3d-hover` treatment while pressed.
export function PressableRow({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: object;
}) {
  const { isDark } = useAppTheme();
  const hover = pillHover(isDark);
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={() => {
        haptic();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.row,
        style,
        pressed
          ? {
              backgroundColor: hover.gradient[0],
              boxShadow: hover.shadows,
            }
          : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

// A `.chip-3d` status chip. Used for the muted marker and the badge counts that
// genuinely need a contained status, never for ordinary metadata.
export function StatusChip({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: ComponentType<{ color?: string; size?: number }>;
}) {
  const { isDark } = useAppTheme();
  const chip = chip3d(isDark);
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: chip.background, borderColor: chip.border },
      ]}
    >
      {Icon ? <Icon color={isDark ? "#b4b4b4" : "#646464"} size={12} /> : null}
      <Text
        style={[styles.chipText, { color: isDark ? "#b4b4b4" : "#646464" }]}
      >
        {children}
      </Text>
    </View>
  );
}

// A row exists only after server acknowledgement: one tick for sent, two for delivery/read.
function receiptGlyph(label: MessageReceipt, color: string) {
  return label === "sent" ? (
    <Check color={color} size={12} />
  ) : (
    <CheckCheck color={color} size={12} />
  );
}

export function ReceiptLine({
  label,
  at,
}: {
  at: string;
  label: MessageReceipt;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.receipt}>
      {receiptGlyph(label, theme.dividerText)}
      <Text style={[styles.receiptText, { color: theme.dividerText }]}>
        {receiptLabel(label)}
        {at ? ` ${at}` : ""}
      </Text>
    </View>
  );
}

// A received bubble's fill: the solid `.bubble-received` surface with the
// translucent top-lit wash over it, which is what the CSS gradient expresses.
export function ReceivedBubbleSurface({
  children,
  corners,
  style,
}: {
  children: React.ReactNode;
  corners: BubbleCorners;
  style?: object;
}) {
  const { isDark } = useAppTheme();
  const recipe = bubbleReceived(isDark);
  return (
    <View
      style={[
        styles.bubbleSurface,
        { backgroundColor: recipe.surface, borderColor: recipe.border },
        corners,
        { boxShadow: recipe.shadows },
        style,
      ]}
    >
      {/* The `.bubble-received` wash: a translucent white band over the top
          60% of a neutral fill. Purely decorative, so it is a plain gradient
          overlay rather than a Gradient3D with no shadow of its own. */}
      <LinearGradient
        colors={[recipe.wash, recipe.washTo]}
        end={{ x: 0.5, y: 0.6 }}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

// Deleted messages keep a bounded neutral surface with the app's inner lip.
export function DeletedBubble({
  maxWidth,
  mine,
}: {
  maxWidth: number;
  mine: boolean;
}) {
  const { isDark, theme } = useAppTheme();
  const surface = surface3d(isDark);
  return (
    <View
      style={[
        styles.deleted,
        {
          backgroundColor: surface.background,
          borderColor: surface.border,
          boxShadow: surface.shadows,
          maxWidth,
        },
        mine ? styles.deletedMine : styles.deletedTheirs,
      ]}
    >
      <Text style={[styles.deletedText, { color: theme.dividerText }]}>
        This message was deleted
      </Text>
    </View>
  );
}

// A presence dot over an avatar. Green when online, amber for idle, and nothing
// at all when offline, so an absent dot reads as "not present" rather than as a
// third state nobody defined.
export function PresenceDot({
  status,
  size = 12,
}: {
  size?: number;
  status: "idle" | "offline" | "online";
}) {
  if (status === "offline") {
    return null;
  }
  return (
    <View
      style={[
        styles.presence,
        {
          backgroundColor: status === "online" ? "#22c55e" : "#f59e0b",
          borderRadius: size / 2,
          height: size,
          width: size,
        },
      ]}
    />
  );
}

// The muted marker on a conversation row. Not a chip: a bare glyph, because the
// row already carries the name and a pill here would compete with it.
export function MutedGlyph() {
  return <BellOff color="#8e8e93" size={13} />;
}

// Resolves a media path from a message payload against the API base. The payload
// carries `/api/media/<id>`, never a raw object-storage address, so this is always
// a same-origin route on the API host.
export function mediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${getApiBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
}

// Both the album and fullscreen viewer share the same account-scoped disk key.
export function MessageImage({
  source,
  style,
  contentFit = "cover",
}: {
  source: string;
  style: object;
  contentFit?: "cover" | "contain";
}) {
  const { mediaCookie, userId } = useMessagesIdentity();
  const request = useMemo(
    () => messageImageSource(source, getApiBaseUrl(), userId, mediaCookie),
    [source, userId, mediaCookie]
  );
  const identity = request.source?.cacheKey ?? request.source?.uri ?? "waiting";
  return (
    <MessageImageContent
      key={identity}
      contentFit={contentFit}
      request={request}
      style={style}
    />
  );
}

function MessageImageContent({
  request,
  style,
  contentFit,
}: {
  request: ReturnType<typeof messageImageSource>;
  style: object;
  contentFit: "cover" | "contain";
}) {
  const { isDark, theme } = useAppTheme();
  const [displayed, setDisplayed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  return (
    <View style={[style, { overflow: "hidden" }]}>
      {!displayed && !failed ? <MessageImageSkeleton /> : null}
      <Image
        key={revision}
        cachePolicy={MESSAGE_IMAGE_CACHE_POLICY}
        contentFit={contentFit}
        onError={() => setFailed(true)}
        onDisplay={() => {
          setFailed(false);
          setDisplayed(true);
        }}
        recyclingKey={request.source?.cacheKey ?? request.source?.uri}
        source={request.source}
        style={StyleSheet.absoluteFill}
        transition={0}
      />
      {failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry image"
          accessibilityHint="Image unavailable. Tap to retry loading it."
          testID="message-image-unavailable"
          onPress={() => {
            setFailed(false);
            setDisplayed(false);
            setRevision((value) => value + 1);
          }}
          style={[
            StyleSheet.absoluteFill,
            styles.imageUnavailable,
            { backgroundColor: isDark ? "#242424" : "#e6e8eb" },
          ]}
        >
          <Image
            contentFit="contain"
            source={noMediaImage}
            style={styles.imageUnavailableArt}
          />
          <Text
            style={[styles.imageUnavailableText, { color: theme.inputText }]}
          >
            Image unavailable
          </Text>
          <Text style={[styles.imageRetryText, { color: theme.dividerText }]}>
            Tap to retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// The image paints over this fixed-size placeholder, including on an instant cache hit.
// Only a genuinely pending image keeps a pulse mounted; cached rows have no idle loop.
function MessageImageSkeleton() {
  const { isDark } = useAppTheme();
  const pulse = useSkeletonPulse();
  const animated = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <View
      accessibilityLabel="Loading message image"
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: isDark ? "#242424" : "#e6e8eb" },
      ]}
    >
      <Animated.View
        testID="message-image-skeleton"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: isDark ? "#34373b" : "#f1f2f4" },
          animated,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleSurface: {
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chip: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
  },
  deleted: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  deletedMine: {
    alignSelf: "flex-end",
  },
  deletedText: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontStyle: "italic",
  },
  deletedTheirs: {
    alignSelf: "flex-start",
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
  },
  imageRetryText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    textAlign: "center",
  },
  imageUnavailable: {
    alignItems: "center",
    gap: 4,
    justifyContent: "center",
    padding: 12,
  },
  imageUnavailableArt: {
    flexShrink: 1,
    height: 80,
    maxHeight: "55%",
    maxWidth: "65%",
    width: 120,
  },
  imageUnavailableText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    textAlign: "center",
  },
  presence: {
    borderColor: "#00000055",
    borderWidth: 2,
    bottom: -1,
    position: "absolute",
    right: -1,
  },
  receipt: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    justifyContent: "flex-end",
    paddingRight: 3,
    paddingTop: 2,
  },
  receiptText: {
    fontFamily: "SofiaProReg",
    fontSize: 10,
  },
  row: {
    borderRadius: 16,
  },
});
