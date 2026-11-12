import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { useAppTheme } from "@/theme";

export function ConversationListSkeleton({
  rows = 7,
  label = "Loading conversations",
}: {
  rows?: number;
  label?: string;
} = {}) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      pointerEvents="none"
      className="gap-1 p-2"
      style={animatedStyle}
    >
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          testID="conversation-skeleton-row"
          className="flex-row items-center gap-3 rounded-2xl px-2.5 py-3"
        >
          <View className="size-10 shrink-0 rounded-xl" style={block} />
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <View
                className={
                  index % 2 ? "h-3.5 w-1/2 rounded" : "h-3.5 w-2/5 rounded"
                }
                style={block}
              />
              <View className="h-2.5 w-8 rounded" style={block} />
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <View
                className={
                  index % 2 ? "h-3 w-3/4 rounded" : "h-3 w-3/5 rounded"
                }
                style={block}
              />
              {index % 3 === 0 ? (
                <View className="size-4 rounded-full" style={block} />
              ) : null}
            </View>
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

export function ThreadSkeleton({
  label = "Loading conversation",
}: { label?: string } = {}) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      pointerEvents="none"
      className="min-h-0 flex-1 justify-end gap-3 overflow-hidden p-4"
      style={animatedStyle}
    >
      <View className="mb-3 h-5 w-16 self-center rounded-full" style={block} />
      {[0, 1, 2, 3, 4].map((index) => (
        <View
          key={index}
          testID="message-skeleton-row"
          className={
            index % 2
              ? "w-44 max-w-[78%] gap-1 self-end"
              : "w-60 max-w-[78%] gap-1 self-start"
          }
        >
          <View
            className={
              index === 2
                ? "h-20 rounded-2xl rounded-bl-md"
                : "h-11 rounded-2xl"
            }
            style={block}
          />
          <View
            className={
              index % 2 ? "h-2 w-8 self-end rounded" : "h-2 w-8 rounded"
            }
            style={block}
          />
        </View>
      ))}
    </Animated.View>
  );
}

export function MessageTilesSkeleton({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <Animated.View
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      pointerEvents="none"
      className="flex-row flex-wrap gap-3 p-4"
      style={animatedStyle}
    >
      {Array.from({ length: compact ? 12 : 6 }, (_, index) => (
        <View
          key={index}
          testID="message-skeleton-tile"
          className={compact ? "size-8 rounded-lg" : "size-20 rounded-xl"}
          style={{ backgroundColor: theme.dividerLine }}
        />
      ))}
    </Animated.View>
  );
}
