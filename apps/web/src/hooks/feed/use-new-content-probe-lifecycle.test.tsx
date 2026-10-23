import { afterAll, afterEach, expect, mock, test } from "bun:test";

import type { FeedChange } from "@asm/protocols/discovery";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { Activity, act } from "react";
import { createRoot } from "react-dom/client";

import { useNewContentProbe } from "./use-new-content-probe";

let feedEvent: (change: FeedChange) => void = () => {};
mock.module("./use-feed-events", () => ({
  useFeedEvents: (_enabled: boolean, onEvent: typeof feedEvent) => {
    feedEvent = onEvent;
  },
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

interface Item {
  id: string;
}
type ProbeOptions = Parameters<typeof useNewContentProbe<Item>>[0];
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

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

function Probe(options: ProbeOptions) {
  const result = useNewContentProbe(options);
  return (
    <button
      onClick={async () => {
        await result.probeNow();
      }}
      type="button"
    >
      {result.newItems.map((item) => item.id).join(",")}
    </button>
  );
}

function createProbe() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  cleanups.push(async () => {
    await act(() => root.unmount());
    client.clear();
    host.remove();
  });
  return {
    items: () => host.textContent,
    probe: () =>
      act(async () => {
        host.querySelector("button")?.click();
        await Promise.resolve();
      }),
    render: (options: ProbeOptions, hidden = false) =>
      act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Activity mode={hidden ? "hidden" : "visible"}>
              <Probe {...options} />
            </Activity>
          </QueryClientProvider>
        );
        await Promise.resolve();
      }),
  };
}

test("a delayed probe compares against posts rendered while the request was in flight", async () => {
  const pending = Promise.withResolvers<Item[]>();
  const fetchHead = mock(() => pending.promise);
  const probe = createProbe();
  await probe.render({ fetchHead, order: "ranked", visible: [] });
  expect(fetchHead).toHaveBeenCalledTimes(1);
  await probe.render({
    fetchHead,
    order: "ranked",
    visible: [{ id: "first" }],
  });
  await act(async () => {
    pending.resolve([{ id: "first" }]);
    await pending.promise;
  });
  expect(probe.items()).toBe("");
});

test("posts that become visible stop counting toward the badge", async () => {
  const fetchHead = mock(() =>
    Promise.resolve([{ id: "new" }, { id: "first" }])
  );
  const probe = createProbe();
  await probe.render({ fetchHead, visible: [{ id: "first" }] });
  expect(probe.items()).toBe("new");
  await probe.render({
    fetchHead,
    visible: [{ id: "new" }, { id: "first" }],
  });
  expect(probe.items()).toBe("");
});

test("buffered posts stop counting when the rendered feed's eligibility changes", async () => {
  const probe = createProbe();
  const fetchHead = mock(() =>
    Promise.resolve([{ id: "new" }, { id: "first" }])
  );
  await probe.render({ fetchHead, visible: [{ id: "first" }] });
  expect(probe.items()).toBe("new");
  await probe.render({
    fetchHead,
    filter: () => false,
    visible: [{ id: "first" }],
  });
  expect(probe.items()).toBe("");
});

test("returning to a cached feed still probes for unseen posts", async () => {
  const fetchHead = mock(() =>
    Promise.resolve([{ id: "new" }, { id: "cached" }])
  );
  const probe = createProbe();
  await probe.render({ fetchHead, visible: [{ id: "cached" }] });
  expect(fetchHead).toHaveBeenCalledTimes(1);
  expect(probe.items()).toBe("new");
});

test("returning to a retained Activity tab probes again without replacing cached posts", async () => {
  const fetchHead = mock(() =>
    Promise.resolve([{ id: "new" }, { id: "cached" }])
  );
  const probe = createProbe();
  const options = { fetchHead, visible: [{ id: "cached" }] };
  await probe.render(options);
  expect(fetchHead).toHaveBeenCalledTimes(1);
  await probe.render(options, true);
  await probe.render(options);
  expect(fetchHead).toHaveBeenCalledTimes(2);
  expect(probe.items()).toBe("new");
  expect(options.visible).toEqual([{ id: "cached" }]);
});

test("a cold load waits for its first page and only later arrivals get a badge", async () => {
  const fetchHead = mock(() =>
    Promise.resolve([{ id: "new" }, { id: "first" }])
  );
  const probe = createProbe();
  await probe.render({ enabled: false, fetchHead, visible: [] });
  await probe.probe();
  expect(fetchHead).toHaveBeenCalledTimes(0);
  await probe.render({
    enabled: true,
    fetchHead,
    probeOnMount: false,
    visible: [{ id: "first" }],
  });
  expect(fetchHead).toHaveBeenCalledTimes(0);
  expect(probe.items()).toBe("");
  await probe.probe();
  expect(probe.items()).toBe("new");
});

test("switching feeds discards a late response from the previous feed", async () => {
  const pending = Promise.withResolvers<Item[]>();
  const probe = createProbe();
  await probe.render({
    fetchHead: () => pending.promise,
    resetKey: "old-feed",
    visible: [{ id: "old" }],
  });
  await probe.render({
    fetchHead: () => Promise.resolve([{ id: "current" }]),
    resetKey: "current-feed",
    visible: [{ id: "current" }],
  });
  await act(async () => {
    pending.resolve([{ id: "late" }, { id: "old" }]);
    await pending.promise;
  });
  expect(probe.items()).toBe("");
});

test("event-backed feeds still poll when their live event stream stays quiet", async () => {
  const fetchHead = mock(() =>
    Promise.resolve([{ id: "arrived" }, { id: "known" }])
  );
  const probe = createProbe();
  await probe.render({
    eventSource: "asm",
    fetchHead,
    intervalMs: 10,
    probeOnMount: false,
    visible: [{ id: "known" }],
  });
  expect(fetchHead).toHaveBeenCalledTimes(0);
  await act(async () => {
    await Bun.sleep(35);
  });
  expect(fetchHead.mock.calls.length).toBeGreaterThan(0);
  expect(probe.items()).toBe("arrived");
});

test("visibility and learning bursts cannot bypass the automatic probe cooldown", async () => {
  const fetchHead = mock(() => Promise.resolve([{ id: "new" }]));
  const probe = createProbe();
  await probe.render({
    fetchHead,
    intervalMs: 60_000,
    probeOnMount: false,
    visible: [{ id: "known" }],
  });
  await act(async () => {
    for (let index = 0; index < 20; index += 1) {
      dom.document.dispatchEvent(new dom.Event("visibilitychange"));
    }
    await Bun.sleep(10);
  });
  expect(fetchHead).toHaveBeenCalledTimes(0);
  await probe.probe();
  expect(fetchHead).toHaveBeenCalledTimes(1);
  expect(probe.items()).toBe("new");
});

test("ranked-head churn cannot accumulate hundreds of pending posts", async () => {
  let page = 0;
  const fetchHead = mock(() =>
    Promise.resolve(
      Array.from({ length: 20 }, (_, index) => ({ id: `${page}-${index}` }))
    )
  );
  const probe = createProbe();
  await probe.render({
    fetchHead,
    order: "ranked",
    visible: [{ id: "known" }],
  });
  for (let index = 0; index < 5; index += 1) {
    page += 1;
    // oxlint-disable-next-line no-await-in-loop -- each probe represents the next changed head.
    await probe.probe();
  }
  expect(probe.items()?.split(",")).toHaveLength(20);
});

test("mode-specific live arrivals wake the Home badge before the long polling interval", async () => {
  const fetchHead = mock(() =>
    Promise.resolve([{ id: "arrived" }, { id: "known" }])
  );
  const probe = createProbe();
  await probe.render({
    eventSource: "asm",
    fetchHead,
    intervalMs: 180_000,
    probeOnMount: false,
    visible: [{ id: "known" }],
  });
  await act(async () => {
    feedEvent({ mode: "personalized", source: "asm" });
    await Bun.sleep(1550);
  });
  expect(fetchHead).toHaveBeenCalledTimes(1);
  expect(probe.items()).toBe("arrived");
});
