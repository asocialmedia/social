import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { useFeedRecovery } from "./use-feed-recovery";

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
const timers = new Map<number, { run: () => unknown; delay: number }>();
let sequence = 0;
dom.setTimeout = ((run: () => unknown, delay: number) => {
  sequence += 1;
  const id = sequence;
  timers.set(id, { delay, run });
  return id;
}) as typeof dom.setTimeout;
dom.clearTimeout = (id?: number) => {
  if (id) {
    timers.delete(id);
  }
};
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, value] of originals) {
    if (value) {
      Object.defineProperty(globalThis, key, value);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("failed continuations retry with backoff, stop after three attempts, and reset after successful progress", async () => {
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  const retry = mock(() => Promise.resolve());
  function Feed({
    fetching,
    updatedAt,
  }: {
    fetching: boolean;
    updatedAt: number;
  }) {
    useFeedRecovery({
      enabled: true,
      failed: true,
      fetching,
      resetKey: "feed",
      retry,
      updatedAt,
    });
    return null;
  }
  try {
    await act(() => root.render(<Feed fetching={false} updatedAt={1} />));
    for (const delay of [2000, 4000, 8000]) {
      const [timer] = [...timers.values()];
      expect(timer?.delay).toBe(delay);
      timers.clear();
      // oxlint-disable-next-line no-await-in-loop -- each timer represents the next failed read.
      await act(async () => {
        await timer?.run();
      });
      // oxlint-disable-next-line no-await-in-loop -- observers enter fetching before the next failure settles.
      await act(() => root.render(<Feed fetching updatedAt={1} />));
      // oxlint-disable-next-line no-await-in-loop -- the retry completes without progress.
      await act(() => root.render(<Feed fetching={false} updatedAt={1} />));
    }
    expect(retry).toHaveBeenCalledTimes(3);
    expect(timers.size).toBe(0);
    await act(() => root.render(<Feed fetching={false} updatedAt={2} />));
    expect([...timers.values()][0]?.delay).toBe(2000);
  } finally {
    await act(() => root.unmount());
    timers.clear();
  }
});
