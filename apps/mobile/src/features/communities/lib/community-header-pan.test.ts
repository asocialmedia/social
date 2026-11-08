// oxlint-disable promise/prefer-await-to-callbacks -- This mock drives synchronous native gesture callbacks.
import { expect, mock, test } from "bun:test";

import {
  communityHeaderFrame,
  communityHeaderProgress,
} from "./community-header-identity";

const handlers: {
  begin?: () => void;
  update?: (event: { translationY: number }) => void;
} = {};
const gesture = {
  activeOffsetY: mock(() => gesture),
  failOffsetX: mock(() => gesture),
  onBegin(callback: () => void) {
    handlers.begin = callback;
    return this;
  },
  onUpdate(callback: (event: { translationY: number }) => void) {
    handlers.update = callback;
    return this;
  },
  runOnJS() {
    return this;
  },
  simultaneousWithExternalGesture() {
    return this;
  },
};
mock.module("react-native-gesture-handler", () => ({
  Gesture: { Pan: () => gesture },
}));
const { Gesture } = await import("react-native-gesture-handler");
const { createCommunityHeaderPan } = await import("./community-header-pan");

test("header drags scroll the feed forward and back while its compact section bar stays visible", () => {
  let offset = 0;
  const positions: number[] = [];
  createCommunityHeaderPan({
    getOffset: () => offset,
    refreshGesture: Gesture.Pan(),
    scrollTo: (value) => {
      offset = value;
      positions.push(value);
    },
  });
  handlers.begin?.();
  expect(positions).toEqual([]);
  expect(gesture.activeOffsetY).toHaveBeenCalledWith([-8, 8]);
  expect(gesture.failOffsetX).toHaveBeenCalledWith([-16, 16]);
  const sectionTop = () =>
    244 +
    communityHeaderFrame(244, communityHeaderProgress(offset, 244), 0).layerY;
  handlers.update?.({ translationY: -100 });
  expect(offset).toBe(100);
  expect(sectionTop()).toBe(144);
  handlers.update?.({ translationY: -800 });
  expect(sectionTop()).toBe(0);
  handlers.begin?.();
  handlers.update?.({ translationY: 750 });
  expect(offset).toBe(50);
  expect(sectionTop()).toBe(194);
});
