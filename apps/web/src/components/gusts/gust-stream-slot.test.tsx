import { afterAll, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { GustStreamSlot } from "./gust-stream-slot";

const dom = new Window({ url: "http://localhost:3000" });
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

test("the pending snap target becomes the next clip without replacing its DOM node", async () => {
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  const render = (ready: boolean, loading: boolean) =>
    root.render([
      <GustStreamSlot index={0} key="gust-slot-0">
        First clip
      </GustStreamSlot>,
      <GustStreamSlot
        index={ready ? 1 : undefined}
        key="gust-slot-1"
        pending={!ready}
        loading={loading}
      >
        {ready ? "Second clip" : "Loading"}
      </GustStreamSlot>,
    ]);
  try {
    await act(() => render(false, true));
    const [, slot] = host.children;
    expect(slot.getAttribute("aria-busy")).toBe("true");
    await act(() => render(false, false));
    expect(host.children[1]).toBe(slot);
    expect(slot.getAttribute("aria-busy")).toBe("false");
    await act(() => render(true, false));
    expect(host.children[1]).toBe(slot);
    expect(slot.getAttribute("aria-label")).toBeNull();
    expect(slot.dataset.index).toBe("1");
    expect(slot.textContent).toBe("Second clip");
  } finally {
    await act(() => root.unmount());
  }
});
