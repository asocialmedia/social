// oxlint-disable promise/prefer-await-to-callbacks, node/callback-return -- The test explicitly drives the synchronous requestAnimationFrame API.
import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

const hide = mock(() => Promise.resolve());
const listeners = new Set<(state: string) => void>();
mock.module("expo-splash-screen", () => ({ hideAsync: hide }));
mock.module("react-native", () => ({
  AppState: {
    addEventListener(_event: string, listener: (state: string) => void) {
      listeners.add(listener);
      return {
        remove() {
          listeners.delete(listener);
        },
      };
    },
  },
}));
const { StartupGate } = await import("./startup-splash");
const dom = new Window();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  cancelAnimationFrame: (id: number) => frames.delete(id),
  document: dom.document,
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    frameId += 1;
    frames.set(frameId, callback);
    return frameId;
  },
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

test("a warm return dismisses the native overlay without replaying startup or restoring navigation", async () => {
  const presented = mock(() => {});
  const root = createRoot(document.createElement("div"));
  try {
    await act(() =>
      root.render(<StartupGate ready={false} onPresented={presented} />)
    );
    for (const listener of listeners) {
      listener("active");
    }
    expect(hide).not.toHaveBeenCalled();
    await act(() => root.render(<StartupGate ready onPresented={presented} />));
    await act(async () => {
      for (let pass = 0; pass < 2; pass += 1) {
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) {
          callback(0);
        }
      }
      await Promise.resolve();
    });
    expect(presented).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (const listener of listeners) {
        listener("background");
        listener("active");
      }
      await Promise.resolve();
    });
    expect(hide).toHaveBeenCalledTimes(2);
    expect(presented).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  } finally {
    await act(() => root.unmount());
  }
  expect(listeners.size).toBe(0);
});
