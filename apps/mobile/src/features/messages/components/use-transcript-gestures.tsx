import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { View } from "react-native";
import type { FlatList, FlatListProps } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import {
  cancelAnimation,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import {
  applySelectionRange,
  invertedContentY,
  messageAtPoint,
  replyOffset,
  selectionRangeIds,
  selectionScrollVelocity,
  shouldReply,
} from "@/features/messages/lib/message-gestures";
import type { MessageFrame } from "@/features/messages/lib/message-gestures";
import type { TranscriptItem } from "@/features/messages/lib/transcript-rows";
import type { MessageData } from "@/features/messages/lib/types";
import { haptic } from "@/lib/haptics";

type CellProps = ComponentProps<
  NonNullable<FlatListProps<TranscriptItem>["CellRendererComponent"]>
>;

export function useTranscriptGestures({
  messages,
  onReply,
  onLiveEndChange,
}: {
  messages: MessageData[];
  onReply: (id: string) => void;
  onLiveEndChange: (atLatest: boolean) => void;
}) {
  const listRef = useAnimatedRef<FlatList<TranscriptItem>>();
  const viewportRef = useRef<View>(null);
  const frames = useSharedValue<Record<string, MessageFrame>>({});
  const viewport = useSharedValue({ height: 0, top: 0 });
  const contentHeight = useSharedValue(0);
  const offset = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const swipeId = useSharedValue("");
  const swipeX = useSharedValue(0);
  const selectionMode = useSharedValue(false);
  const reduceMotion = useReducedMotion();
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const selectedRef = useRef(selectedIds);
  const messagesRef = useRef(messages);
  const dragRef = useRef<{
    anchor: string;
    base: ReadonlySet<string>;
    mode: "add" | "remove";
  } | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const autoScroll = useFrameCallback((frame) => {
    if (!dragging.get()) {
      return;
    }
    const bounds = viewport.get();
    const speed = selectionScrollVelocity(
      fingerY.get(),
      bounds.top,
      bounds.height
    );
    if (speed === 0) {
      return;
    }
    const next = Math.max(
      0,
      Math.min(
        Math.max(0, contentHeight.get() - bounds.height),
        offset.get() +
          (speed * Math.min(frame.timeSincePreviousFrame ?? 16, 32)) / 1000
      )
    );
    if (next !== offset.get()) {
      offset.set(next);
      scrollTo(listRef, 0, next, false);
    }
  }, false);

  const commit = useCallback(
    (next: ReadonlySet<string>) => {
      selectedRef.current = next;
      setSelectedIds(next);
      selectionMode.set(next.size > 0);
    },
    [selectionMode]
  );
  const clearSelection = useCallback(() => commit(new Set()), [commit]);
  const toggleSelected = useCallback(
    (id: string) => {
      const next = new Set(selectedRef.current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      commit(next);
      haptic();
    },
    [commit]
  );
  const handleSelectAll = useCallback(() => {
    commit(new Set(messagesRef.current.map((message) => message.id)));
    haptic();
  }, [commit]);
  const beginSelection = useCallback(
    (id: string) => {
      const base = selectedRef.current;
      const mode = base.has(id) ? "remove" : "add";
      dragRef.current = { anchor: id, base, mode };
      commit(applySelectionRange(base, [id], mode));
      autoScroll.setActive(true);
      haptic("hold");
    },
    [autoScroll, commit]
  );
  const updateSelection = useCallback(
    (id: string) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      commit(
        applySelectionRange(
          drag.base,
          selectionRangeIds(messagesRef.current, drag.anchor, id),
          drag.mode
        )
      );
      haptic();
    },
    [commit]
  );
  const finishSelection = useCallback(() => {
    dragRef.current = null;
    autoScroll.setActive(false);
  }, [autoScroll]);
  useEffect(() => () => autoScroll.setActive(false), [autoScroll]);
  const handleViewportLayout = useCallback(() => {
    viewportRef.current?.measureInWindow((_x, top, _width, height) => {
      viewport.set({ height, top });
    });
  }, [viewport]);
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeight.set(height);
    },
    [contentHeight]
  );

  const CellRenderer = useMemo(
    () =>
      function MeasuredCell(props: CellProps) {
        return <MessageCell {...props} frames={frames} />;
      },
    [frames]
  );

  const nativeScroll = useMemo(() => createNativeScrollGesture(), []);
  const gesture = useMemo(() => {
    const selection = createPanGesture()
      .maxPointers(1)
      .activateAfterLongPress(350)
      // oxlint-disable-next-line react/refs -- retains the native recognizer for touch arbitration, without reading a ref during render
      .blocksExternalGesture(nativeScroll)
      // oxlint-disable-next-line react/refs -- registers a worklet for native events; its captured refs are only read after a touch
      .onStart((event) => {
        const bounds = viewport.get();
        const id = messageAtPoint(
          frames.get(),
          invertedContentY(
            event.absoluteY,
            bounds.top,
            bounds.height,
            offset.get()
          )
        );
        if (id) {
          fingerY.set(event.absoluteY);
          dragging.set(true);
          scheduleOnRN(beginSelection, id);
        }
      })
      .onUpdate((event) => {
        fingerY.set(event.absoluteY);
      })
      // oxlint-disable-next-line react/refs -- registers touch cleanup; no captured ref is read while creating the recognizer
      .onFinalize(() => {
        dragging.set(false);
        scheduleOnRN(finishSelection);
      });
    const swipe = createPanGesture()
      .maxPointers(1)
      .activeOffsetX(12)
      .failOffsetY([-8, 8])
      // oxlint-disable-next-line react/refs -- retains the native recognizer for touch arbitration, without reading a ref during render
      .blocksExternalGesture(nativeScroll)
      // oxlint-disable-next-line react/refs -- registers a worklet for native events; its captured refs are only read after a touch
      .onStart((event) => {
        if (selectionMode.get()) {
          return;
        }
        const bounds = viewport.get();
        const id = messageAtPoint(
          frames.get(),
          invertedContentY(
            event.absoluteY,
            bounds.top,
            bounds.height,
            offset.get()
          )
        );
        cancelAnimation(swipeX);
        swipeX.set(0);
        swipeId.set(id ?? "");
      })
      .onUpdate((event) => {
        if (swipeId.get()) {
          swipeX.set(replyOffset(event.translationX));
        }
      })
      .onEnd((event) => {
        const id = swipeId.get();
        if (id && shouldReply(event.translationX, event.velocityX)) {
          scheduleOnRN(onReply, id);
        }
      })
      .onFinalize(() => {
        if (reduceMotion) {
          swipeX.set(0);
          swipeId.set("");
        } else {
          swipeX.set(
            withSpring(0, { dampingRatio: 1, duration: 400 }, (finished) => {
              if (finished) {
                swipeId.set("");
              }
            })
          );
        }
      });
    return raceGestures(selection, swipe);
  }, [
    beginSelection,
    dragging,
    fingerY,
    finishSelection,
    frames,
    nativeScroll,
    offset,
    onReply,
    reduceMotion,
    selectionMode,
    swipeId,
    swipeX,
    viewport,
  ]);

  // Only a crossed message boundary reaches React; finger motion stays on the UI runtime.
  useAnimatedReaction(
    () => {
      if (!dragging.get()) {
        return null;
      }
      const bounds = viewport.get();
      return messageAtPoint(
        frames.get(),
        invertedContentY(fingerY.get(), bounds.top, bounds.height, offset.get())
      );
    },
    (id, previous) => {
      if (id && id !== previous) {
        scheduleOnRN(updateSelection, id);
      }
    }
  );
  const handleScroll = useAnimatedScrollHandler((event) => {
    offset.set(event.contentOffset.y);
  });
  useAnimatedReaction(
    () => offset.get() <= 60,
    (atLatest, previous) => {
      if (atLatest !== previous) {
        scheduleOnRN(onLiveEndChange, atLatest);
      }
    }
  );

  return {
    CellRenderer,
    clearSelection,
    gesture,
    handleContentSizeChange,
    handleScroll,
    handleSelectAll,
    handleViewportLayout,
    listRef,
    nativeScroll,
    selectedIds,
    swipeId,
    swipeX,
    toggleSelected,
    viewportRef,
  };
}

function createNativeScrollGesture() {
  return Gesture.Native();
}
function createPanGesture() {
  return Gesture.Pan();
}
function raceGestures(...gestures: Parameters<typeof Gesture.Race>) {
  return Gesture.Race(...gestures);
}
function MessageCell({
  item,
  children,
  onLayout,
  style,
  frames,
}: CellProps & {
  frames: SharedValue<Record<string, MessageFrame>>;
}) {
  const id = item.kind === "message" ? item.message.id : null;
  useEffect(
    () => () => {
      if (id) {
        frames.set((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(([key]) => key !== id)
          )
        );
      }
    },
    [frames, id]
  );
  return (
    <View
      style={style}
      onLayout={(event) => {
        onLayout?.(event);
        if (id) {
          const { y, height } = event.nativeEvent.layout;
          frames.set((previous) => ({ ...previous, [id]: { height, y } }));
        }
      }}
    >
      {children}
    </View>
  );
}
