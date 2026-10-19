import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useEffect } from "react";

import { rememberFeedExposure } from "@/lib/posts/feed-exposure";
import type { FeedExposureSurface } from "@/lib/posts/feed-exposure";

import { useFeedExposures } from "./use-feed-exposures";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  Event: dom.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  localStorage: dom.localStorage,
  navigator: dom.navigator,
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

function Probe({
  surface,
  changed,
}: {
  surface: FeedExposureSurface;
  changed: (ids: Set<string>) => void;
}) {
  const seen = useFeedExposures("reader", surface);
  useEffect(() => {
    changed(seen);
  }, [changed, seen]);
  return <output data-surface={surface}>{[...seen].join(",")}</output>;
}

test("mounted sections react to opposite-section views without feeding their own exposure back into rendering", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const homeChanged = mock();
  const gustsChanged = mock();
  await act(() =>
    root.render(
      <>
        <Probe surface="home" changed={homeChanged} />
        <Probe surface="gusts" changed={gustsChanged} />
      </>
    )
  );
  await act(() => rememberFeedExposure("reader", "home", "viewed-video"));
  expect(host.querySelector('[data-surface="gusts"]')?.textContent).toBe(
    "viewed-video"
  );
  expect(host.querySelector('[data-surface="home"]')?.textContent).toBe("");
  expect(homeChanged).toHaveBeenCalledTimes(1);
  expect(gustsChanged).toHaveBeenCalledTimes(2);
  await act(() =>
    rememberFeedExposure("another-reader", "home", "private-view")
  );
  expect(homeChanged).toHaveBeenCalledTimes(1);
  expect(gustsChanged).toHaveBeenCalledTimes(2);
  await act(() => root.unmount());
  host.remove();
});
