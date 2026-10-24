import { afterAll, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import type { NetworkSettings } from "@asm/protocols/discovery";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

mock.module("@/lib/auth/session-context", () => ({
  useSession: () => ({ user: { id: "optimistic-viewer" } }),
}));
const toast = mock();
mock.module("@/lib/gooey-toast", () => ({ useToast: () => ({ toast }) }));
const { useNetworkSettings } = await import("./use-network-settings");
const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  Event: dom.Event,
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
const seed: NetworkSettings = {
  catalog: [],
  persona: {
    avoidedTopics: [],
    learnedInterests: [],
    relatedInterests: [],
    signalCount: 0,
  },
  preferences: defaultNetworkPreferences(),
  revision: 0,
};
function Probe() {
  const ui = useNetworkSettings({ optimistic: true });
  const feed = useNetworkSettings();
  return (
    <>
      <span data-ui>
        {ui.settings.preferences.profiles[0]?.interests.join(",")}
      </span>
      <span data-confirmed>
        {feed.settings.preferences.profiles[0]?.interests.join(",")}
      </span>
      {["software", "art"].map((interest) => (
        <button
          key={interest}
          onClick={() =>
            ui.save({
              ...ui.settings.preferences,
              profiles: ui.settings.preferences.profiles.map((profile) => ({
                ...profile,
                interests: [...profile.interests, interest],
              })),
            })
          }
          type="button"
        >
          {interest}
        </button>
      ))}
    </>
  );
}

test("rapid selections update immediately while serialized writes use each committed revision", async () => {
  toast.mockClear();
  const fetchBefore = globalThis.fetch;
  const writes: {
    preferences: NetworkSettings["preferences"];
    revision: number;
    resolve: (response: Response) => void;
  }[] = [];
  globalThis.fetch = mock((_input, init) => {
    const pending = Promise.withResolvers<Response>();
    const body: {
      preferences: NetworkSettings["preferences"];
      revision: number;
    } = JSON.parse(String(init?.body));
    writes.push({ ...body, resolve: pending.resolve });
    return pending.promise;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["network-settings", "optimistic-viewer"], seed);
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      );
    });
    await act(() => {
      host.querySelectorAll("button")[0]?.click();
    });
    expect(host.querySelector("[data-ui]")?.textContent).toBe("software");
    expect(host.querySelector("[data-confirmed]")?.textContent).toBe("");
    await act(() => {
      host.querySelectorAll("button")[1]?.click();
    });
    expect(host.querySelector("[data-ui]")?.textContent).toBe("software,art");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.revision).toBe(0);
    await act(async () => {
      writes[0]?.resolve(
        Response.json({
          ...seed,
          preferences: writes[0].preferences,
          revision: 1,
        })
      );
      await Bun.sleep(10);
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]?.revision).toBe(1);
    expect(writes[1]?.preferences.profiles[0]?.interests).toEqual([
      "software",
      "art",
    ]);
    await act(async () => {
      writes[1]?.resolve(
        Response.json({
          ...seed,
          preferences: writes[1].preferences,
          revision: 2,
        })
      );
      await Bun.sleep(10);
    });
    expect(host.querySelector("[data-confirmed]")?.textContent).toBe(
      "software,art"
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Network settings saved" })
    );
  } finally {
    await act(() => root.unmount());
    host.remove();
    client.clear();
    globalThis.fetch = fetchBefore;
  }
});

test("a failed save rolls back queued selections and the next save uses the refreshed revision", async () => {
  const fetchBefore = globalThis.fetch;
  const firstResponse = Promise.withResolvers<Response>();
  const writes: {
    preferences: NetworkSettings["preferences"];
    revision: number;
  }[] = [];
  const refreshed = { ...seed, revision: 7 };
  globalThis.fetch = mock((_input, init) => {
    if (init?.method !== "PUT") {
      return Promise.resolve(Response.json(refreshed));
    }
    const body: {
      preferences: NetworkSettings["preferences"];
      revision: number;
    } = JSON.parse(String(init.body));
    writes.push(body);
    return writes.length === 1
      ? firstResponse.promise
      : Promise.resolve(
          Response.json({
            ...refreshed,
            preferences: body.preferences,
            revision: 8,
          })
        );
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["network-settings", "optimistic-viewer"], seed);
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      );
    });
    await act(() => host.querySelectorAll("button")[0]?.click());
    await act(() => host.querySelectorAll("button")[1]?.click());
    expect(host.querySelector("[data-ui]")?.textContent).toBe("software,art");
    await act(async () => {
      firstResponse.resolve(
        Response.json({ error: "Settings changed" }, { status: 409 })
      );
      await Bun.sleep(20);
    });
    expect(writes).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't save Network settings",
        variant: "destructive",
      })
    );
    expect(host.querySelector("[data-ui]")?.textContent).toBe("");
    expect(host.querySelector("[data-confirmed]")?.textContent).toBe("");
    await act(async () => {
      host.querySelectorAll("button")[1]?.click();
      await Bun.sleep(20);
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]?.revision).toBe(7);
    expect(writes[1]?.preferences.profiles[0]?.interests).toEqual(["art"]);
    expect(host.querySelector("[data-confirmed]")?.textContent).toBe("art");
  } finally {
    await act(() => root.unmount());
    host.remove();
    client.clear();
    globalThis.fetch = fetchBefore;
  }
});
