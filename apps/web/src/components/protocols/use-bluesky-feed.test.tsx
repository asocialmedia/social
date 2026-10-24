import { afterAll, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import type { DiscoveryMode } from "@asm/protocols/discovery";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

const preferences = defaultNetworkPreferences();
const page = { cursor: crypto.randomUUID(), items: [], partial: false };
const headReads: {
  mode: DiscoveryMode;
  profile?: string;
  refresh?: boolean;
}[] = [];
let probe: { fetchHead: (signal: AbortSignal) => Promise<unknown> } | undefined;
const actual = await import("@asm/protocols/discovery");
mock.module("@asm/protocols/discovery", () => ({
  ...actual,
  readDiscoveryPage: (options: (typeof headReads)[number]) => {
    headReads.push(options);
    return Promise.resolve(page);
  },
  readDiscoveryWindow: () => Promise.resolve(page),
}));
mock.module("@/hooks/feed/use-discovery-locale", () => ({
  useDiscoveryLocale: () => ({ locale: "en", ready: true }),
}));
mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings: () => ({
    ready: true,
    scope: "fixture",
    settings: { preferences },
  }),
}));
mock.module("@/hooks/feed/use-feed-events", () => ({ useFeedEvents() {} }));
mock.module("@/hooks/feed/use-feed-exposures", () => ({
  useFeedExposures: () => new Set<string>(),
}));
mock.module("@/hooks/feed/use-new-content-probe", () => ({
  useNewContentProbe: (options: NonNullable<typeof probe>) => {
    probe = options;
    return {
      clearNewItems() {},
      newItems: [],
      probeNow: () => Promise.resolve(),
    };
  },
}));
mock.module("@/store/feed-source-store", () => ({
  useExternalExclusions: () => new Set<string>(),
}));
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
const { useBlueskyFeed } = await import("./use-bluesky-feed");
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
function Feed({
  mode,
  following,
}: {
  mode: DiscoveryMode;
  following: boolean;
}) {
  useBlueskyFeed(mode, true, "reader", "all", following);
  return null;
}
test.each([
  { expected: "latest", following: false, mode: "personalized" as const },
  { expected: "trending", following: false, mode: "trending" as const },
  { expected: "personalized", following: true, mode: "personalized" as const },
])(
  "new-content probes use $expected for $mode with following=$following",
  async ({ mode, following, expected }) => {
    const client = new QueryClient();
    const host = dom.document.createElement("div");
    const root = createRoot(host as unknown as HTMLElement);
    try {
      await act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <Feed mode={mode} following={following} />
          </QueryClientProvider>
        )
      );
      if (!probe) {
        throw new Error("Expected a head probe");
      }
      await probe.fetchHead(new AbortController().signal);
      expect(headReads.at(-1)).toMatchObject({
        mode: expected,
        profile: "default",
        refresh: true,
      });
    } finally {
      await act(() => root.unmount());
      client.clear();
    }
  }
);
