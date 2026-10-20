import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { gustPagingState } from "@/lib/posts/gust-feed";

import { GustFeedErrorState, GustSourceRetries } from "./gust-source-retries";

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

test.each(["ASM", "Bluesky"])(
  "%s failure exposes only its own retry while its peer remains usable",
  async (failedSource) => {
    const host = dom.document.createElement("div");
    const root = createRoot(host as unknown as HTMLElement);
    const sources = ["ASM", "Bluesky"].map((label) => ({
      handleRetry: mock(() => {}),
      hasError: label === failedSource,
      isFetching: false,
      label,
    }));
    try {
      await act(() => root.render(<GustSourceRetries sources={sources} />));
      const buttons = host.querySelectorAll("button");
      expect(buttons.length).toBe(1);
      expect(buttons[0].textContent).toBe(`Retry ${failedSource} videos`);
      await act(() => buttons[0].click());
      for (const source of sources) {
        expect(source.handleRetry).toHaveBeenCalledTimes(
          source.hasError ? 1 : 0
        );
      }
      const retrying = sources.map((source) => ({
        ...source,
        isFetching: source.hasError,
      }));
      await act(() => root.render(<GustSourceRetries sources={retrying} />));
      expect(host.querySelector("button")?.disabled).toBe(true);
      await act(() =>
        root.render(
          <GustSourceRetries
            sources={sources.map((source) => ({ ...source, hasError: false }))}
          />
        )
      );
      expect(host.querySelector("button")).toBeNull();
    } finally {
      await act(() => root.unmount());
    }
  }
);

test("both failed sources retain separate retry actions", async () => {
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  const sources = ["ASM", "Bluesky"].map((label) => ({
    handleRetry: mock(() => {}),
    hasError: true,
    isFetching: false,
    label,
  }));
  try {
    await act(() => root.render(<GustSourceRetries sources={sources} />));
    const buttons = host.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    await act(() => buttons[1].click());
    expect(sources[0].handleRetry).not.toHaveBeenCalled();
    expect(sources[1].handleRetry).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
  }
});

test.each(["ASM", "Bluesky"])(
  "empty reel keeps the failed %s retry after the healthy peer is exhausted",
  async (failedSource) => {
    const host = dom.document.createElement("div");
    const root = createRoot(host as unknown as HTMLElement);
    const sharedRetry = mock(() => {});
    const sources = ["ASM", "Bluesky"].map((label) => ({
      enabled: true,
      handleRetry: mock(() => {}),
      hasError: label === failedSource,
      hasNextPage: label === failedSource,
      isFetchNextPageError: label === failedSource,
      isFetching: false,
      isFetchingNextPage: false,
      label,
    }));
    const paging = gustPagingState(sources);
    expect(paging.canFetchNextPage).toBe(false);
    expect(paging.pageError).toBe(true);
    try {
      await act(() =>
        root.render(
          <GustFeedErrorState onRetry={sharedRetry} sources={sources} />
        )
      );
      const buttons = [...host.querySelectorAll("button")];
      expect(buttons.length).toBe(2);
      const sourceButton = buttons.find(
        (button) => button.textContent === `Retry ${failedSource} videos`
      );
      expect(sourceButton).toBeDefined();
      await act(() => sourceButton?.click());
      expect(sharedRetry).not.toHaveBeenCalled();
      for (const source of sources) {
        expect(source.handleRetry).toHaveBeenCalledTimes(
          source.hasError ? 1 : 0
        );
      }
      const sharedButton = buttons.find(
        (button) => button.textContent === "Try again"
      );
      expect(sharedButton).toBeDefined();
      await act(() => sharedButton?.click());
      expect(sharedRetry).toHaveBeenCalledTimes(1);
    } finally {
      await act(() => root.unmount());
    }
  }
);
