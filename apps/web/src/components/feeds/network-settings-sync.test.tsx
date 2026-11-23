import { expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { trendingFeedQueryKey } from "@/lib/recommendations/trending-query";

mock.module("@/lib/auth/session-context", () => ({
  useSession: () => ({ user: { id: "viewer" } }),
}));
mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings() {},
}));

const { NetworkSettingsSync } = await import("./network-settings-sync");

test("settings events reset current Trending data and learning invalidates it for this viewer", async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    IS_REACT_ACT_ENVIRONMENT: true,
    window: dom,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const client = new QueryClient();
  const root = createRoot(
    dom.document.createElement("div") as unknown as HTMLElement
  );
  const channel = new BroadcastChannel("asm-network-settings");
  const key = trendingFeedQueryKey("viewer");
  const other = trendingFeedQueryKey("other");
  const waitForChange = (condition: () => boolean) => {
    const done = Promise.withResolvers<boolean>();
    const unsubscribe = client.getQueryCache().subscribe(() => {
      if (condition()) {
        unsubscribe();
        done.resolve(true);
      }
    });
    return done.promise;
  };
  try {
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <NetworkSettingsSync />
        </QueryClientProvider>
      )
    );
    client.setQueryData(other, "other-viewer's topics");
    client.setQueryData(key, "previous topics");
    dom.dispatchEvent(new dom.Event("network:settings-changed"));
    expect(client.getQueryData(key)).toBeUndefined();

    client.setQueryData(key, "previous profile");
    const reset = waitForChange(() => !client.getQueryData(key));
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin argument.
    channel.postMessage("changed");
    await reset;
    expect(client.getQueryData(key)).toBeUndefined();

    client.setQueryData(key, "current topics");
    const invalidated = waitForChange(() =>
      Boolean(client.getQueryState(key)?.isInvalidated)
    );
    dom.dispatchEvent(new dom.Event("network:learned"));
    await invalidated;
    expect(client.getQueryData(key)).toBe("current topics");
    expect(client.getQueryData(other)).toBe("other-viewer's topics");
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  } finally {
    channel.close();
    await act(() => root.unmount());
    client.clear();
    await dom.happyDOM.close();
    for (const [property, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(globalThis, property, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, property);
      }
    }
  }
});
