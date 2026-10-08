import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { ViewStyle, StyleProp } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { AnimatedRef } from "react-native-reanimated";
import Animated, { measure, useAnimatedRef } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { haptic } from "@/lib/haptics";

import type { FeedMedia, FeedPost } from "../lib/feed-types";
import { useMediaPreviewStore } from "../state/media-preview-store";
import type { MediaBounds } from "../state/media-preview-store";

const createLongPress = Gesture.LongPress;

export const MediaPostContext = createContext<FeedPost | null>(null);

function openPreview(post: FeedPost, media: FeedMedia, bounds: MediaBounds) {
  haptic("hold");
  useMediaPreviewStore.getState().open({ bounds, media, post });
}

function createHoldGesture(
  ref: AnimatedRef<Animated.View>,
  post: FeedPost | null,
  media: FeedMedia
) {
  return createLongPress()
    .enabled(Boolean(post))
    .minDuration(350)
    .maxDistance(10)
    .shouldCancelWhenOutside(true)
    .onStart(() => {
      const bounds = measure(ref);
      if (post && bounds && bounds.width > 0 && bounds.height > 0) {
        scheduleOnRN(openPreview, post, media, {
          height: bounds.height,
          width: bounds.width,
          x: bounds.pageX,
          y: bounds.pageY,
        });
      }
    });
}

export function MediaHold({
  children,
  media,
  style,
}: {
  children: ReactNode;
  media: FeedMedia;
  style?: StyleProp<ViewStyle>;
}) {
  const post = useContext(MediaPostContext);
  const ref = useAnimatedRef<Animated.View>();
  const gesture = useMemo(
    // oxlint-disable-next-line react/refs -- creation retains the animated ref for the native gesture callback, without reading it during render
    () => createHoldGesture(ref, post, media),
    [media, post, ref]
  );
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        collapsable={false}
        ref={ref}
        style={style}
        accessibilityActions={
          post ? [{ label: "Media actions", name: "longpress" }] : undefined
        }
        onAccessibilityAction={(event) => {
          if (post && event.nativeEvent.actionName === "longpress") {
            ref.current?.measureInWindow((x, y, width, height) =>
              openPreview(post, media, { height, width, x, y })
            );
          }
        }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
