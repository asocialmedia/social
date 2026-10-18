import { afterAll, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import type { NetworkSettings } from "@asm/protocols/discovery";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { NetworkSettingsSync } from "@/components/feeds/network-settings-sync";

import { useNetworkSettings } from "./use-network-settings";

mock.module("@/lib/auth/session-context", () => ({
  useSession: () => ({ user: { id: "settings-race-test" } }),
}));

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  Event: dom.Event,
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

test("a slow preference save never caches an old-policy feed under the future revision", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const peer = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let saved: NetworkSettings = {
    catalog: [],
    persona: {
      avoidedTopics: [],
      learnedInterests: [],
      relatedInterests: [],
      signalCount: 0,
    },
    preferences: defaultNetworkPreferences(),
    revision: 4,
  };
  client.setQueryData(["network-settings", "settings-race-test"], saved);
  peer.setQueryData(["network-settings", "settings-race-test"], saved);
  const { promise: saveGate, resolve: releaseSave } =
    Promise.withResolvers<undefined>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      await saveGate;
      saved = {
        ...saved,
        preferences: body.preferences,
        revision: saved.revision + 1,
      };
    }
    return Response.json(saved);
  }) as typeof fetch;
  const reads: { scope: string; avoided: string[] }[] = [];
  const peerReads: typeof reads = [];
  let settings: ReturnType<typeof useNetworkSettings> | undefined;
  function Feed({ foreign = false }: { foreign?: boolean }) {
    const network = useNetworkSettings();
    useEffect(() => {
      if (!foreign) {
        settings = network;
      }
    }, [foreign, network]);
    useQuery({
      enabled: network.ready,
      queryFn: () => {
        (foreign ? peerReads : reads).push({
          avoided: saved.preferences.avoidedTopics,
          scope: network.scope,
        });
        return Promise.resolve(saved.revision);
      },
      queryKey: ["race-feed", network.scope],
      staleTime: Infinity,
    });
    return null;
  }
  const root = createRoot(
    dom.document.createElement("div") as unknown as HTMLElement
  );
  const peerRoot = createRoot(
    dom.document.createElement("div") as unknown as HTMLElement
  );
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <NetworkSettingsSync />
          <Feed />
        </QueryClientProvider>
      );
      await Bun.sleep(30);
    });
    await act(async () => {
      peerRoot.render(
        <QueryClientProvider client={peer}>
          <NetworkSettingsSync />
          <Feed foreign />
        </QueryClientProvider>
      );
      await Bun.sleep(30);
    });
    expect(reads).toHaveLength(1);
    await act(async () => {
      settings?.save({
        ...saved.preferences,
        avoidedTopics: ["furry", "porn"],
      });
      await Bun.sleep(30);
    });
    expect(settings?.isSaving).toBe(true);
    expect(settings?.settings.revision).toBe(4);
    expect(reads).toHaveLength(1);
    await act(async () => {
      releaseSave();
      await Bun.sleep(30);
    });
    await act(async () => {
      await Bun.sleep(30);
    });
    expect(reads).toHaveLength(2);
    expect(reads[1]).toEqual({
      avoided: ["furry", "porn"],
      scope: "v4:default:5:exact",
    });
    await act(async () => {
      await Bun.sleep(30);
    });
    expect(peerReads.at(-1)).toEqual({
      avoided: ["furry", "porn"],
      scope: "v4:default:5:exact",
    });
  } finally {
    releaseSave();
    await act(() => root.unmount());
    await act(() => peerRoot.unmount());
    globalThis.fetch = originalFetch;
    client.clear();
    peer.clear();
  }
});
