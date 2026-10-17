import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";

import { useSeamlessFeedHead } from "./use-seamless-feed-head";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
Object.defineProperty(dom.HTMLElement.prototype, "checkVisibility", {
  configurable: true,
  value: () => true,
});
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

test("a feed that mounts after loading merges buffered posts only when returning to the top", async () => {
  const host = dom.document.createElement("div");
  host.style.overflowY = "auto";
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const merge = mock(() => null);
  const probe = mock(() => Promise.resolve());
  function Feed({ ready, count }: { ready: boolean; count: number }) {
    const ref = useRef<HTMLDivElement>(null);
    useSeamlessFeedHead({ count, enabled: ready, merge, probe, root: ref });
    return ready ? <div ref={ref}>Posts</div> : null;
  }
  await act(() => {
    root.render(<Feed ready={false} count={0} />);
  });
  await act(() => {
    root.render(<Feed ready count={2} />);
  });
  await act(() => {
    host.scrollTop = 500;
    host.dispatchEvent(new dom.Event("scroll"));
  });
  expect(merge).toHaveBeenCalledTimes(0);
  await act(() => {
    host.scrollTop = 0;
    host.dispatchEvent(new dom.Event("scroll"));
  });
  expect(merge).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledTimes(1);
  await act(() => {
    root.unmount();
  });
  host.remove();
});
