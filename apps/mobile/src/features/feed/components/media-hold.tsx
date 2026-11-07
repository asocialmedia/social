import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import type { ViewStyle, StyleProp } from "react-native";
import { AppState } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { AnimatedRef } from "react-native-reanimated";
import Animated, { measure, useAnimatedRef } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { haptic } from "@/lib/interaction/haptics";

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
  // Web's hold drawer only arms for IMAGE/VIDEO rows on a real post that is
  // neither explicit-locked nor moderated; scroll cancels via the 10px slop
  // (a scrolling finger cannot hold still for 350ms) and the scroll view
  // taking the responder.
  const armed =
    Boolean(post) &&
    !post?.explicitContent &&
    !post?.moderated &&
    (media.type === "IMAGE" || media.type === "VIDEO");
  return createLongPress()
    .enabled(armed)
    .minDuration(350)
    .maxDistance(10)
    .shouldCancelWhenOutside(true)
    .onStart(() => {
      "worklet";
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

// Web's blur/visibility interrupt: backgrounding closes the open preview so
// no modal (and no preview video audio) survives the app switch. One shared
// subscription no matter how many holds mount.
let backgroundInterruptStarted = false;

function ensureBackgroundInterrupt(): void {
  if (backgroundInterruptStarted) {
    return;
  }
  backgroundInterruptStarted = true;
  AppState.addEventListener("change", (state) => {
    if (state !== "active") {
      useMediaPreviewStore.getState().close();
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
  useEffect(() => {
    ensureBackgroundInterrupt();
  }, []);
  // The switch-access path honors the same arming as the gesture: no preview
  // for audio rows or explicit/moderated posts.
  const armed =
    Boolean(post) &&
    !post?.explicitContent &&
    !post?.moderated &&
    (media.type === "IMAGE" || media.type === "VIDEO");
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
          armed ? [{ label: "Media actions", name: "longpress" }] : undefined
        }
        onAccessibilityAction={(event) => {
          if (armed && post && event.nativeEvent.actionName === "longpress") {
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
