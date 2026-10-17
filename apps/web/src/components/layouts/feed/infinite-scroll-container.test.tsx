import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

mock.module("react-intersection-observer", () => ({
  useInView: () => ({ inView: true, ref: () => {} }),
}));
const { default: InfiniteScrollContainer } =
  await import("./infinite-scroll-container");
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
test("a visible sentinel requests the next page again after a short page settles", async () => {
  const load = mock(() => {});
  const root = createRoot(
    dom.document.createElement("div") as unknown as HTMLElement
  );
  function Feed({ fetching }: { fetching: boolean }) {
    return (
      <InfiniteScrollContainer
        onBottomReached={() => {
          if (!fetching) {
            load();
          }
        }}
      >
        Posts
      </InfiniteScrollContainer>
    );
  }
  await act(() => root.render(<Feed fetching={false} />));
  expect(load).toHaveBeenCalledTimes(1);
  await act(() => root.render(<Feed fetching />));
  expect(load).toHaveBeenCalledTimes(1);
  await act(() => root.render(<Feed fetching={false} />));
  expect(load).toHaveBeenCalledTimes(2);
  await act(() => root.unmount());
});
