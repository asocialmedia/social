import { afterAll, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

import { TopicPicker } from "./topic-picker";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  Event: dom.Event,
  HTMLElement: dom.HTMLElement,
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

const entry = (label: string) => ({
  aliases: [],
  id: label,
  label,
  source: "wikimedia",
});

test("interest and moderation pickers browse live children, support search autocomplete and select suggested labels", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["network-topics", "", "root"], {
    aliases: [],
    items: [entry("Live root")],
    parent: null,
    partial: false,
  });
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      await Promise.resolve();
      const url = new URL(String(input), "http://localhost");
      requests.push(url.search);
      const items = url.searchParams.has("q")
        ? [entry("Autocomplete result")]
        : [entry("Live child")];
      return Response.json({
        aliases: [],
        items,
        parent: url.searchParams.get("parent"),
        partial: false,
      });
    },
    { preconnect: originalFetch.preconnect }
  );
  const chosen: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <TopicPicker
            disabled={false}
            label="Topic to avoid"
            limit={64}
            onToggle={(topic) => chosen.push(topic)}
            selected={[]}
          />
        </QueryClientProvider>
      );
    });
    const explore = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Explore topics related to Live root"]'
    );
    expect(explore).not.toBeNull();
    await act(async () => {
      explore?.click();
      await Bun.sleep(30);
    });
    await act(async () => {
      await Bun.sleep(30);
    });
    expect(host.textContent).toContain("Live child");
    const choice = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Live child"
    );
    await act(async () => {
      choice?.click();
      await Bun.sleep(30);
    });
    expect(chosen).toEqual(["live child"]);
    expect(requests.some((query) => query.includes("parent=Live+root"))).toBe(
      true
    );

    const input = host.querySelector<HTMLInputElement>("input");
    const setValue = Object.getOwnPropertyDescriptor(
      dom.HTMLInputElement.prototype,
      "value"
    )?.set;
    await act(() => {
      setValue?.call(input, "aut");
      input?.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => {
      await Bun.sleep(300);
    });
    await act(async () => {
      await Bun.sleep(30);
    });
    expect(host.textContent).toContain("Autocomplete result");
    expect(requests.some((query) => query.includes("q=aut"))).toBe(true);
  } finally {
    await act(() => {
      root.unmount();
    });
    host.remove();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});
