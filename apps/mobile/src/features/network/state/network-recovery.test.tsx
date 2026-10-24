import { afterAll, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import { Window } from "happy-dom";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { recentNetworkSearchScope } from "../../search/lib/recent-search-scope";
import type { ProtocolPage } from "./use-protocol-pages";

const retryPreferences = mock(() => Promise.resolve());
const network = {
  error: "Preferences unavailable",
  locale: "en",
  ready: false,
  refetch: retryPreferences,
  request: { locale: "en", profile: "default", scope: "test" },
  scope: "test",
  settings: { preferences: defaultNetworkPreferences() },
};
mock.module("@/features/network/state/use-network-settings", () => ({
  useNetworkSettings: () => network,
}));
mock.module("@/features/auth/lib/auth-client", () => ({
  authClient: { getCookie: () => Promise.resolve() },
}));
mock.module("@/features/feed/lib/feed-events", () => ({
  subscribeFeedReads: () => () => {},
}));
mock.module("@/lib/api-env", () => ({
  getApiBaseUrl: () => "https://asm.test",
}));
mock.module("@/lib/telemetry", () => ({ logWarn() {} }));
const files = new Map<string, string>();
const historyFile = (viewer: string) =>
  `asm-network-search-${encodeURIComponent(viewer)}.json`;
mock.module("expo-file-system", () => ({
  File: class {
    readonly name: string;
    constructor(_directory: unknown, name: string) {
      this.name = name;
    }
    text() {
      return Promise.resolve(files.get(this.name) ?? "[]");
    }
    write(contents: string) {
      files.set(this.name, contents);
      return Promise.resolve();
    }
  },
  Paths: { document: "memory" },
}));
const { useFeedTab } = await import("../../feed/state/use-feed");
const { useProtocolPages } = await import("./use-protocol-pages");
const { useRecentNetworkSearches } =
  await import("../../search/state/use-recent-network-searches");
const dom = new Window();
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

test("a failed preference prerequisite exposes an error and retries the preferences read", async () => {
  let feed: ReturnType<typeof useFeedTab> | undefined;
  function Probe() {
    const value = useFeedTab({
      enabled: true,
      userId: "viewer",
      variant: "latest",
    });
    useEffect(() => {
      feed = value;
    }, [value]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(() => root.render(<Probe />));
    expect(feed?.status).toBe("error");
    expect(feed?.error).toBe("Preferences unavailable");
    await act(() => feed?.refresh());
    expect(retryPreferences).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
  }
});

test("refresh aborts pagination and restores the ability to load another page", async () => {
  const delayed = Promise.withResolvers<ProtocolPage<string, string>>();
  const requests: AbortSignal[] = [];
  const read = (cursor: string | null, signal: AbortSignal) => {
    if (!cursor) {
      return Promise.resolve({ cursor: "next", items: ["first"] });
    }
    requests.push(signal);
    return requests.length === 1
      ? delayed.promise
      : Promise.resolve({ cursor: null, items: ["new-page"] });
  };
  let pages: ReturnType<typeof useProtocolPages<string, string>> | undefined;
  function Probe() {
    const value = useProtocolPages("recovery-pages", read);
    useEffect(() => {
      pages = value;
    }, [value]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(() => root.render(<Probe />));
    await act(async () => {
      await Bun.sleep(10);
    });
    await act(() => {
      void pages?.fetchNext();
    });
    expect(pages?.loadingMore).toBe(true);
    await act(async () => {
      await pages?.refresh();
    });
    expect(requests[0]?.aborted).toBe(true);
    expect(pages?.loadingMore).toBe(false);
    await act(() => delayed.resolve({ cursor: null, items: ["aborted-page"] }));
    expect(pages?.items).not.toContain("aborted-page");
    await act(async () => {
      await pages?.fetchNext();
    });
    expect(pages?.items).toEqual(["first", "new-page"]);
    expect(pages?.loadingMore).toBe(false);
  } finally {
    await act(() => root.unmount());
  }
});

test("recent searches keep one persistent file through preference revisions and stay profile scoped", async () => {
  let recent: ReturnType<typeof useRecentNetworkSearches> | undefined;
  function Probe({
    profile,
    revision,
    generation,
  }: {
    profile: string;
    revision: number;
    generation: number;
  }) {
    void revision;
    void generation;
    const value = useRecentNetworkSearches(
      recentNetworkSearchScope("viewer", profile)
    );
    useEffect(() => {
      recent = value;
    }, [value]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => {
      root.render(<Probe profile="anime" revision={1} generation={1} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Bun.sleep(10);
    });
    await act(() => recent?.remember("animation", "all"));
    expect(files.size).toBe(1);
    await act(() =>
      root.render(<Probe profile="anime" revision={2} generation={0} />)
    );
    expect(recent?.items[0]?.query).toBe("animation");
    expect(files.size).toBe(1);
    await act(async () => {
      root.render(<Probe profile="engineering" revision={3} generation={2} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Bun.sleep(10);
    });
    expect(recent?.items).toEqual([]);
    await act(async () => {
      root.render(<Probe profile="anime" revision={4} generation={0} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Bun.sleep(10);
    });
    expect(recent?.items[0]?.query).toBe("animation");
  } finally {
    await act(() => root.unmount());
  }
});

test("long result labels survive a cold history read without dropping other recents", async () => {
  let recent: ReturnType<typeof useRecentNetworkSearches> | undefined;
  function Probe({ viewer }: { viewer: string }) {
    const value = useRecentNetworkSearches(viewer);
    useEffect(() => {
      recent = value;
    }, [value]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const showHistory = async (viewer: string) => {
    await act(async () => {
      root.render(<Probe viewer={viewer} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Bun.sleep(10);
    });
  };
  try {
    await showHistory("long-label-writer");
    await act(() => recent?.remember("previous search", "asm"));
    await act(() =>
      recent?.remember("long post", "bluesky", {
        href: "/network/bluesky?uri=at%3A%2F%2Fdid%3Aplc%3Aexample%2Fapp.bsky.feed.post%2F1",
        label: "long Bluesky post ".repeat(40),
      })
    );
    expect(recent?.items).toHaveLength(2);
    expect(recent?.items[0]?.label).toHaveLength(280);
    const saved = files.get(historyFile("long-label-writer"));
    expect(saved).toBeDefined();
    const entries = JSON.parse(saved ?? "[]");
    expect(entries[0].label).toHaveLength(280);
    // A fresh cache key forces a disk read, as on the next app launch.
    files.set(historyFile("long-label-reader"), saved ?? "[]");
    await showHistory("long-label-reader");
    expect(recent?.items.map((item) => item.query)).toEqual([
      "long post",
      "previous search",
    ]);
    // Recover older files that were saved before labels were normalized.
    entries[0].label = "legacy long post ".repeat(40);
    files.set(historyFile("legacy-label-reader"), JSON.stringify(entries));
    await showHistory("legacy-label-reader");
    expect(recent?.items).toHaveLength(2);
    expect(recent?.items[0]?.label).toHaveLength(280);
    expect(recent?.items[1]?.query).toBe("previous search");
  } finally {
    await act(() => root.unmount());
  }
});
