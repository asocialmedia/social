import { afterAll, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

let pathname = "/";
const scope = "profile-safety-scope";
mock.module("next/navigation", () => ({ usePathname: () => pathname }));
mock.module("@/lib/auth/session-context", () => ({
  useSession: () => ({ user: { id: "reader" } }),
}));
mock.module("./use-network-settings", () => ({
  useNetworkSettings: () => ({ scope }),
}));
const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
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
const { useSecondaryFeedReady } = await import("./use-secondary-feed-ready");
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
function Probe() {
  const ready = useSecondaryFeedReady();
  return <output>{String(ready)}</output>;
}
test("optional reads wait for the current viewer and settings scope rather than another cached account", async () => {
  const client = new QueryClient();
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    );
    expect(host.textContent).toBe("false");
    await act(() => {
      client.setQueryData(["post-feed", "for-you", "other-reader", scope], {
        pages: [],
      });
      client.setQueryData(["post-feed", "for-you", "reader", "old-scope"], {
        pages: [],
      });
    });
    expect(host.textContent).toBe("false");
    await act(() => {
      client.setQueryData(["post-feed", "for-you", "reader", scope], {
        pages: [],
      });
    });
    expect(host.textContent).toBe("true");
    pathname = "/settings";
    await act(() => {
      client.clear();
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      );
    });
    expect(host.textContent).toBe("true");
  } finally {
    await act(() => root.unmount());
    client.clear();
    host.remove();
  }
});
