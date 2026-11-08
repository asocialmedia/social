import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

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
function touch(y: number): TouchEvent {
  return { allTouches: [{ absoluteX: 20, absoluteY: y }], numberOfTouches: 1 };
}
const animate = () => ({ start() {} });
mock.module("react-native", () => ({
  Animated: { Value: AnimatedValue, spring: animate, timing: animate },
  Easing: { bezier() {} },
  Platform: { OS: "android" },
}));
mock.module("@/features/feed/components/pull-loader", () => ({
  PULL_THRESHOLD: 72,
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

test("restored offsets reject refresh, top crossings retain the recognizer, and cancellation never refreshes", async () => {
  const refresh = mock(() => {});
  let offset = 1400;
  const scrollOffset = { get: () => offset };
  let pull: ReturnType<typeof usePullToRefresh> | undefined;
  function Probe() {
    const result = usePullToRefresh({
      failed: false,
      onRefresh: refresh,
      refreshing: false,
      scrollOffset,
    });
    useEffect(() => {
      pull = result;
    }, [result]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const manager = { activate: mock(() => {}), fail: mock(() => {}) };
  try {
    await act(() => root.render(<Probe />));
    const gesture = pans.at(-1);
    expect(gesture).toBeDefined();
    gesture?.down?.(touch(0), manager);
    expect(manager.fail).toHaveBeenCalledTimes(1);
    offset = 0;
    gesture?.move?.(touch(200), manager);
    expect(manager.activate).not.toHaveBeenCalled();
    gesture?.finalize?.({}, false);
    expect(refresh).not.toHaveBeenCalled();

    await act(() => {
      pull?.onScrollOffset(500);
      root.render(<Probe />);
    });
    expect(pans.at(-1)).toBe(gesture);
    await act(() => {
      pull?.onScrollOffset(0);
      root.render(<Probe />);
    });
    expect(pans.at(-1)).toBe(gesture);
    gesture?.down?.(touch(0), manager);
    gesture?.move?.(touch(20), manager);
    expect(manager.activate).toHaveBeenCalledTimes(1);
    gesture?.update?.({ translationY: 20 });
    gesture?.update?.({ translationY: 220 });
    pull?.onScrollEndDrag();
    gesture?.finalize?.({}, false);
    expect(refresh).not.toHaveBeenCalled();

    gesture?.down?.(touch(0), manager);
    gesture?.move?.(touch(20), manager);
    gesture?.update?.({ translationY: 20 });
    gesture?.update?.({ translationY: 220 });
    pull?.onScrollEndDrag();
    gesture?.finalize?.({}, true);
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
  }
});
