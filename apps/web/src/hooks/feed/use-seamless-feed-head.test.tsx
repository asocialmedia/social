import { afterAll, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { FEED_POST_VISIBLE_EVENT } from "@/lib/posts/recommendation-visibility";

import { useSeamlessFeedHead } from "./use-seamless-feed-head";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
Object.defineProperty(dom.HTMLElement.prototype, "checkVisibility", {
  configurable: true,
  value: () => true,
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

test("automatic head admission preserves the unread pill and waits for pagination", async () => {
  const host = dom.document.createElement("div");
  host.style.overflowY = "auto";
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  let merges = 0;
  function Feed({
    paging = false,
    refreshing = false,
  }: {
    paging?: boolean;
    refreshing?: boolean;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    const [pending, setPending] = useState([{ id: "new" }, { id: "another" }]);
    const [inserted, setInserted] = useState<typeof pending>([]);
    const notice = useSeamlessFeedHead({
      count: pending.length,
      enabled: true,
      merge: () => {
        merges += 1;
        setInserted(pending);
        setPending([]);
      },
      paging,
      pendingItems: pending,
      probe: async () => {},
      refreshing,
      root: ref,
    });
    return (
      <div
        ref={(node) => {
          ref.current = node;
          if (node) {
            node.getBoundingClientRect = () => ({
              bottom: 1000,
              height: 1000,
              left: 0,
              right: 400,
              toJSON() {},
              top: -host.scrollTop,
              width: 400,
              x: 0,
              y: -host.scrollTop,
            });
          }
        }}
      >
        <output>{notice.unreadItems.length}</output>
        {inserted.map(({ id }) => (
          <article data-post-id={id} key={id}>
            {id}
          </article>
        ))}
      </div>
    );
  }
  try {
    await act(() => root.render(<Feed paging />));
    await act(async () => {
      host.scrollTop = 500;
      host.dispatchEvent(new dom.Event("scroll"));
      await Bun.sleep(40);
    });
    expect(merges).toBe(0);
    await act(async () => {
      root.render(<Feed refreshing />);
      await Bun.sleep(40);
    });
    expect(merges).toBe(0);
    await act(async () => {
      root.render(<Feed />);
      await Bun.sleep(40);
    });
    await act(async () => {
      await Bun.sleep(40);
    });
    expect(merges).toBe(1);
    expect(host.querySelector("output")?.textContent).toBe("2");
    expect(host.scrollTop).toBe(500);
    await act(async () => {
      host.querySelector('[data-post-id="new"]')?.dispatchEvent(
        new dom.CustomEvent(FEED_POST_VISIBLE_EVENT, {
          bubbles: true,
          detail: "new",
        })
      );
      await Bun.sleep(40);
    });
    expect(host.querySelector("output")?.textContent).toBe("1");
    await act(async () => {
      host.scrollTop = 0;
      host.dispatchEvent(new dom.Event("scroll"));
      await Bun.sleep(40);
    });
    expect(host.querySelector("output")?.textContent).toBe("0");
    expect(merges).toBe(1);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

function FeedAtHead() {
  const ref = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState([{ id: "live" }]);
  const notice = useSeamlessFeedHead({
    count: pending.length,
    enabled: true,
    merge: () => setPending([]),
    pendingItems: pending,
    probe: async () => {},
    root: ref,
  });
  return (
    <div ref={ref}>
      <output>{notice.unreadItems.length}</output>
      {pending.length === 0 ? <article data-post-id="live" /> : null}
    </div>
  );
}

test("a batch that arrives at the latest post is inserted without a lasting pill", async () => {
  const host = dom.document.createElement("div");
  host.style.overflowY = "auto";
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(() => root.render(<FeedAtHead />));
    await act(async () => {
      await Bun.sleep(40);
    });
    expect(host.querySelector('[data-post-id="live"]')).toBeTruthy();
    expect(host.querySelector("output")?.textContent).toBe("0");
    expect(host.scrollTop).toBe(0);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
