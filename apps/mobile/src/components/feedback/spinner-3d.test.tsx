import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useMemo } from "react";
import type { PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";

const repeat = mock(() => 360);
const cancel = mock(() => {});
let reducedMotion = false;
function Surface({ children }: PropsWithChildren) {
  return <div>{children}</div>;
}
function useRotation(initial: number) {
  return useMemo(() => ({ value: initial }), [initial]);
}
mock.module("react-native", () => ({ View: Surface }));
mock.module("react-native-reanimated", () => ({
  Easing: { linear: (value: number) => value },
  cancelAnimation: cancel,
  createAnimatedComponent: () => Surface,
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => reducedMotion,
  useSharedValue: useRotation,
  withRepeat: repeat,
  withTiming: (value: number) => value,
}));
mock.module("react-native-svg", () => ({
  Circle: "circle",
  Defs: "defs",
  LinearGradient: "linearGradient",
  Path: "path",
  Stop: "stop",
  default: "svg",
}));
const { Spinner3D } = await import("./spinner-3d");
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

test("the real spinner starts, stops, respects reduced motion, and cancels on unmount", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(() => root.render(<Spinner3D color="#ffffff" />));
    expect(repeat).toHaveBeenCalledTimes(1);
    expect(container.querySelector('path[fill="#ffffff"]')).not.toBeNull();
    await act(() => root.render(<Spinner3D animating={false} />));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(repeat).toHaveBeenCalledTimes(1);
    reducedMotion = true;
    await act(() => root.render(<Spinner3D />));
    expect(repeat).toHaveBeenCalledTimes(1);
    reducedMotion = false;
    await act(() => root.render(<Spinner3D />));
    expect(repeat).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => root.unmount());
  }
  expect(cancel).toHaveBeenCalledTimes(2);
});
