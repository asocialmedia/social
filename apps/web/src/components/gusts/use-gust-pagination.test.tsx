import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";

import { useGustPagination } from "./use-gust-pagination";

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
const { createRoot } = await import("react-dom/client");
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

function Paging({
  options,
}: {
  options: Parameters<typeof useGustPagination>[0];
}) {
  useGustPagination(options);
  return null;
}

test("a fast scroll to the pending slot fetches despite a stale active-card observer and fractional geometry", async () => {
  const container = dom.document.createElement("div");
  Object.defineProperties(container, {
    clientHeight: { value: 776 },
    scrollHeight: { value: 40_000.03125 },
  });
  const fetchNextPage = mock(() => Promise.resolve());
  const root = createRoot(
    dom.document.createElement("div") as unknown as HTMLElement
  );
  const options = {
    activeIndex: 0,
    canFetchNextPage: true,
    containerRef: { current: container as unknown as HTMLDivElement },
    delayMs: 0,
    fetchNextPage,
    isFetchingNextPage: false,
    loadedPages: 3,
    scope: "anime",
    visiblePosts: 50,
  };
  try {
    await act(() => root.render(<Paging options={options} />));
    await Bun.sleep(5);
    expect(fetchNextPage).not.toHaveBeenCalled();
    container.scrollTop = 39_224;
    container.dispatchEvent(new dom.Event("scroll"));
    await Bun.sleep(5);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    await act(() =>
      root.render(<Paging options={{ ...options, isFetchingNextPage: true }} />)
    );
    container.dispatchEvent(new dom.Event("scroll"));
    await Bun.sleep(5);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
  }
});

test("short reels refill before scrolling and a sparse completed page continues without an intersection event", async () => {
  const fetchNextPage = mock(() => Promise.resolve());
  const root = createRoot(
    dom.document.createElement("div") as unknown as HTMLElement
  );
  const options = {
    activeIndex: 0,
    canFetchNextPage: true,
    containerRef: { current: null },
    delayMs: 0,
    fetchNextPage,
    isFetchingNextPage: false,
    loadedPages: 1,
    scope: "anime",
    visiblePosts: 16,
  };
  try {
    await act(() => root.render(<Paging options={options} />));
    await Bun.sleep(5);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    await act(() =>
      root.render(<Paging options={{ ...options, loadedPages: 2 }} />)
    );
    await Bun.sleep(5);
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
    await act(() =>
      root.render(
        <Paging options={{ ...options, loadedPages: 3, visiblePosts: 30 }} />
      )
    );
    await Bun.sleep(5);
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => root.unmount());
  }
});

test("changing source eligibility cancels an outstanding sparse-page backoff", async () => {
  const fetchNextPage = mock(() => Promise.resolve());
  const root = createRoot(
    dom.document.createElement("div") as unknown as HTMLElement
  );
  const options = {
    activeIndex: 0,
    canFetchNextPage: true,
    containerRef: { current: null },
    delayMs: 30,
    fetchNextPage,
    isFetchingNextPage: false,
    loadedPages: 1,
    scope: "anime",
    visiblePosts: 0,
  };
  try {
    await act(() => root.render(<Paging options={options} />));
    await act(() =>
      root.render(
        <Paging
          options={{ ...options, canFetchNextPage: false, scope: "other" }}
        />
      )
    );
    await Bun.sleep(50);
    expect(fetchNextPage).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
  }
});
