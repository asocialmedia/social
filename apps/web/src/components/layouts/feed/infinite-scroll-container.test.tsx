import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

let observation: (IntersectionObserverInit & { skip?: boolean }) | undefined;
const observe = mock(() => {
  // The test controls intersection state instead of a browser observer.
});
mock.module("react-intersection-observer", () => ({
  useInView: (options: IntersectionObserverInit & { skip?: boolean }) => {
    observation = options;
    return { inView: !options.skip, ref: observe };
  },
}));
const { default: InfiniteScrollContainer } =
  await import("./infinite-scroll-container");
const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
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

test("pagination observes the feed's nearest scroll container with room for a slow response", async () => {
  const host = dom.document.createElement("div");
  host.style.overflowY = "auto";
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const load = mock(() => {
    // Record the request without fetching a real page.
  });
  await act(() =>
    root.render(
      <div style={{ overflowY: "hidden" }}>
        <InfiniteScrollContainer onBottomReached={load}>
          Posts
        </InfiniteScrollContainer>
      </div>
    )
  );
  expect(observation?.root).toBe(host);
  expect(observation?.rootMargin).toBe("0px 0px 8000px 0px");
  expect(load).toHaveBeenCalledTimes(1);
  await act(() => root.unmount());
  host.remove();
});

test("stale intersection state cannot immediately fetch another page after a tall page appends", async () => {
  const host = dom.document.createElement("div");
  host.style.overflowY = "auto";
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const load = mock(() => {
    // Record the request without fetching a real page.
  });
  await act(() =>
    root.render(
      <InfiniteScrollContainer onBottomReached={load}>
        First page
      </InfiniteScrollContainer>
    )
  );
  expect(load).toHaveBeenCalledTimes(1);
  const sentinel = host.querySelector("[data-feed-sentinel]");
  expect(sentinel).not.toBeNull();
  Object.defineProperty(sentinel, "getBoundingClientRect", {
    value: () => ({ bottom: 12_001, top: 12_000 }),
  });
  await act(() =>
    root.render(
      <InfiniteScrollContainer onBottomReached={() => load()}>
        Two pages
      </InfiniteScrollContainer>
    )
  );
  expect(load).toHaveBeenCalledTimes(1);
  await act(() => root.unmount());
  host.remove();
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

test("sparse continuation keeps its deadline across callback rerenders and uses the latest callback", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const first = mock(() => {});
  const latest = mock(() => {});
  try {
    await act(() =>
      root.render(
        <InfiniteScrollContainer
          continuationDelay={200}
          onBottomReached={first}
        >
          Posts
        </InfiniteScrollContainer>
      )
    );
    await Bun.sleep(110);
    await act(() =>
      root.render(
        <InfiniteScrollContainer
          continuationDelay={200}
          onBottomReached={latest}
        >
          Posts updated
        </InfiniteScrollContainer>
      )
    );
    await act(() => Bun.sleep(120));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

test("delayed continuation rechecks the sentinel after content pushes it out of range", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const load = mock(() => {});
  try {
    await act(() =>
      root.render(
        <InfiniteScrollContainer continuationDelay={30} onBottomReached={load}>
          Posts
        </InfiniteScrollContainer>
      )
    );
    Object.defineProperty(
      host.querySelector("[data-feed-sentinel]"),
      "getBoundingClientRect",
      { value: () => ({ bottom: 20_001, top: 20_000 }) }
    );
    await act(() => Bun.sleep(60));
    expect(load).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

test("unmount cancels an outstanding sparse continuation", async () => {
  const root = createRoot(
    dom.document.createElement("div") as unknown as HTMLElement
  );
  const load = mock(() => {});
  await act(() =>
    root.render(
      <InfiniteScrollContainer continuationDelay={30} onBottomReached={load}>
        Posts
      </InfiniteScrollContainer>
    )
  );
  await act(() => root.unmount());
  await Bun.sleep(60);
  expect(load).not.toHaveBeenCalled();
});
