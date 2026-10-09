// Small pieces the messages screens share, kept in one file because each is a few
// lines and they exist to make the screens read like the web components rather than
// like a list of inline style arrays.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BellOff, Check, CheckCheck, Clock } from "lucide-react-native";
import { useState } from "react";
import type { ComponentType } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { BubbleCorners } from "@/features/messages/lib/message-bubble-shape";
import { messageImageSource } from "@/features/messages/lib/message-image-source";
import type { MessageReceipt } from "@/features/messages/lib/message-receipts";
import { receiptLabel } from "@/features/messages/lib/message-receipts";
import {
  bubbleReceived,
  chip3d,
  iconButton3d,
  pillHover,
} from "@/features/messages/lib/message-recipes";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import { getApiBaseUrl } from "@/lib/api-env";
import { haptic } from "@/lib/haptics";
import { imageCachePolicy } from "@/lib/image-cache";
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

// "Sent" is a clock, "Delivered" one tick, "Read" two: the same progression a
// person expects from every other messenger. Returned as elements rather than
// component references, because selecting a component during render would make it
// a fresh component type each pass.
function receiptGlyph(label: MessageReceipt, color: string) {
  if (label === "read") {
    return <CheckCheck color={color} size={12} />;
  }
  if (label === "delivered") {
    return <Check color={color} size={12} />;
  }
  return <Clock color={color} size={12} />;
}

// The receipt line under an own message. "Sent" is a clock, "Delivered" one tick,
// "Read" two -- the same progression a person expects from every other messenger,
// and the timestamp the watermark carries, not the message's own clock.
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

// The "This message was deleted" tombstone: dashed border, italic, no fill.
export function DeletedBubble({ mine }: { mine: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.deleted,
        { borderColor: `${theme.dividerText}66` },
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

// An image in a message, with the same cache policy the feed uses so a GIF in a
// transcript does not get evicted like a thumbnail would.
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
  const { theme } = useAppTheme();
  const request = messageImageSource(
    source,
    getApiBaseUrl(),
    userId,
    mediaCookie
  );
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  return (
    <View style={[style, { overflow: "hidden" }]}>
      <Image
        key={`${source}:${revision}`}
        cachePolicy={request.privateMedia ? "memory" : imageCachePolicy(source)}
        contentFit={contentFit}
        onError={() => setFailedSource(source)}
        onLoad={() => {
          setFailedSource(null);
          setLoadedSource(source);
        }}
        recyclingKey={request.source?.cacheKey ?? source}
        source={request.source}
        style={StyleSheet.absoluteFill}
        transition={120}
      />
      {loadedSource !== source && failedSource !== source ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              backgroundColor: `${theme.dividerText}20`,
              justifyContent: "center",
            },
          ]}
        >
          <ActivityIndicator
            accessibilityLabel="Loading message image"
            color={theme.dividerText}
            size="small"
          />
        </View>
      ) : null}
      {failedSource === source ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry image"
          onPress={() => {
            setFailedSource(null);
            setRevision((value) => value + 1);
          }}
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: "center",
              backgroundColor: theme.containerBg,
              justifyContent: "center",
              padding: 12,
            },
          ]}
        >
          <Text
            style={{
              color: theme.dividerText,
              fontFamily: "SofiaProReg",
              fontSize: 12,
            }}
          >
            Image unavailable. Tap to retry.
          </Text>
        </Pressable>
      ) : null}
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
    borderStyle: "dashed",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  deletedMine: {
    alignSelf: "flex-end",
    maxWidth: "78%",
  },
  deletedText: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontStyle: "italic",
  },
  deletedTheirs: {
    alignSelf: "flex-start",
    maxWidth: "78%",
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
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
