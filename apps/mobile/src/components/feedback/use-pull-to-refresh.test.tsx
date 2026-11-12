import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

const PULL_THRESHOLD = 90;

interface Touch {
  absoluteX: number;
  absoluteY: number;
}
interface TouchEvent {
  allTouches: Touch[];
  numberOfTouches: number;
}
interface Manager {
  activate: () => void;
  fail: () => void;
}

class MockGesture {
  down?: (event: TouchEvent, manager: Manager) => void;
  move?: (event: TouchEvent, manager: Manager) => void;
  update?: (event: { translationY: number }) => void;
  finalize?: (event: unknown, success: boolean) => void;
  activeOffsetY() {
    return this;
  }
  failOffsetX() {
    return this;
  }
  maxPointers() {
    return this;
  }
  onBegin(handler: () => void) {
    this.begin = handler;
    return this;
  }
  begin?: () => void;
  enabled() {
    return this;
  }
  runOnJS() {
    return this;
  }
  manualActivation() {
    return this;
  }
  simultaneousWithExternalGesture() {
    return this;
  }
  onTouchesDown(handler: NonNullable<MockGesture["down"]>) {
    this.down = handler;
    return this;
  }
  onTouchesMove(handler: NonNullable<MockGesture["move"]>) {
    this.move = handler;
    return this;
  }
  onUpdate(handler: NonNullable<MockGesture["update"]>) {
    this.update = handler;
    return this;
  }
  onFinalize(handler: NonNullable<MockGesture["finalize"]>) {
    this.finalize = handler;
    return this;
  }
}
const pans: MockGesture[] = [];
mock.module("react-native-gesture-handler", () => ({
  Gesture: {
    Native: () => new MockGesture(),
    Pan: () => {
      const gesture = new MockGesture();
      pans.push(gesture);
      return gesture;
    },
  },
}));
function AnimatedValue(initial: number) {
  let current = initial;
  return {
    setValue(value: number) {
      current = value;
    },
    get value() {
      return current;
    },
  };
}
const animate = () => ({ start() {} });
mock.module("react-native", () => ({
  Animated: { Value: AnimatedValue, spring: animate, timing: animate },
  Easing: { bezier() {} },
  Platform: { OS: "android" },
}));
mock.module("@/features/feed/components/pull-loader", () => ({
  PULL_THRESHOLD,
  PullLoader: () => null,
}));

const { usePullToRefresh } = await import("./use-pull-to-refresh");
const dom = new Window();
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("refresh counts only the extra pull after reaching the top and ignores cancelled gestures", async () => {
  const refresh = mock(() => {});
  let offset = 1400;
  function Probe() {
    usePullToRefresh({
      failed: false,
      onRefresh: refresh,
      refreshing: false,
      scrollOffset: { get: () => offset },
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(() => root.render(<Probe />));
    const gesture = pans.at(-1);
    gesture?.begin?.();
    gesture?.update?.({ translationY: 200 });
    gesture?.finalize?.({}, true);
    expect(refresh).not.toHaveBeenCalled();
    gesture?.begin?.();
    offset = 0;
    gesture?.update?.({ translationY: 300 });
    gesture?.finalize?.({}, true);
    expect(refresh).not.toHaveBeenCalled();
    gesture?.begin?.();
    gesture?.update?.({ translationY: 20 });
    gesture?.update?.({ translationY: 220 });
    gesture?.finalize?.({}, false);
    expect(refresh).not.toHaveBeenCalled();
    gesture?.begin?.();
    gesture?.update?.({ translationY: 20 });
    gesture?.update?.({ translationY: 220 });
    gesture?.finalize?.({}, true);
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
  }
});
