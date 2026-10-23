import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";

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

test("a feed that mounts after loading merges buffered posts only when returning to the top", async () => {
  const host = dom.document.createElement("div");
  host.style.overflowY = "auto";
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const merge = mock(() => null);
  const probe = mock(() => Promise.resolve());
  function Feed({ ready, count }: { ready: boolean; count: number }) {
    const ref = useRef<HTMLDivElement>(null);
    useSeamlessFeedHead({ count, enabled: ready, merge, probe, root: ref });
    return ready ? <div ref={ref}>Posts</div> : null;
  }
  await act(() => {
    root.render(<Feed ready={false} count={0} />);
  });
  await act(() => {
    root.render(<Feed ready count={2} />);
  });
  await act(() => {
    host.scrollTop = 500;
    host.dispatchEvent(new dom.Event("scroll"));
  });
  expect(merge).toHaveBeenCalledTimes(0);
  await act(() => {
    host.scrollTop = 0;
    host.dispatchEvent(new dom.Event("scroll"));
  });
  expect(merge).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledTimes(1);
  await act(() => {
    root.unmount();
  });
  host.remove();
});

test("scrolling downwards never merges buffered posts", async () => {
  const host = dom.document.createElement("div");
  host.style.overflowY = "auto";
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const merge = mock(() => null);
  const probe = mock(() => Promise.resolve());
  function Feed() {
    const ref = useRef<HTMLDivElement>(null);
    useSeamlessFeedHead({ count: 5, enabled: true, merge, probe, root: ref });
    return <div ref={ref}>Posts</div>;
  }
  await act(() => {
    root.render(<Feed />);
  });
  // Scrolling down from 0 to 200 should not trigger merge
  await act(() => {
    host.scrollTop = 200;
    host.dispatchEvent(new dom.Event("scroll"));
  });
  expect(merge).toHaveBeenCalledTimes(0);
  await act(() => {
    root.unmount();
  });
  host.remove();
});

test("a feed sitting below a composer merges buffered posts when scrolling up to the feed boundary", async () => {
  const host = dom.document.createElement("div");
  host.style.overflowY = "auto";
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const merge = mock(() => null);
  const probe = mock(() => Promise.resolve());
  function FeedWithComposer() {
    const feedRef = useRef<HTMLDivElement>(null);
    useSeamlessFeedHead({
      count: 3,
      enabled: true,
      merge,
      probe,
      root: feedRef,
    });
    return (
      <div>
        <div style={{ height: "200px" }}>Composer</div>
        <div ref={feedRef}>Feed</div>
      </div>
    );
  }
  await act(() => {
    root.render(<FeedWithComposer />);
  });
  // Mock bounding rects so feed is 200px below host container
  const feedEl = host.querySelector("div > div:nth-child(2)") as HTMLElement;
  if (feedEl) {
    Object.defineProperty(host, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 600,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        width: 800,
      }),
    });
    Object.defineProperty(feedEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 200 - host.scrollTop + 500,
        height: 500,
        left: 0,
        right: 800,
        top: 200 - host.scrollTop,
        width: 800,
      }),
    });
  }
  // User scrolls down into the feed
  await act(() => {
    host.scrollTop = 800;
    host.dispatchEvent(new dom.Event("scroll"));
  });
  expect(merge).toHaveBeenCalledTimes(0);
  // User scrolls back up to the feed boundary (200px)
  await act(() => {
    host.scrollTop = 200;
    host.dispatchEvent(new dom.Event("scroll"));
  });
  expect(merge).toHaveBeenCalledTimes(1);
  await act(() => {
    root.unmount();
  });
  host.remove();
});

test.each([false, true])(
  "a late head response merges only while still at the head (leave=%s)",
  async (leave) => {
    const host = dom.document.createElement("div");
    host.style.overflowY = "auto";
    dom.document.body.append(host);
    const root = createRoot(host as unknown as HTMLElement);
    const merge = mock(() => null);
    const probe = mock(() => Promise.resolve());
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    function Feed({ count }: { count: number }) {
      const ref = useRef<HTMLDivElement>(null);
      useSeamlessFeedHead({ count, enabled: true, merge, probe, root: ref });
      return <div ref={ref}>Posts</div>;
    }
    try {
      await act(() => root.render(<Feed count={0} />));
      const feed = host.firstElementChild;
      if (!feed) {
        throw new Error("Missing feed");
      }
      Object.defineProperty(feed, "getBoundingClientRect", {
        value: () => ({ top: -host.scrollTop }),
      });
      await act(() =>
        host.dispatchEvent(new dom.WheelEvent("wheel", { deltaY: -100 }))
      );
      expect(probe).toHaveBeenCalledTimes(1);
      now += 15_000;
      if (leave) {
        await act(() => {
          host.scrollTop = 500;
          host.dispatchEvent(new dom.Event("scroll"));
        });
      }
      await act(() => root.render(<Feed count={1} />));
      expect(merge).toHaveBeenCalledTimes(leave ? 0 : 1);
      if (!leave) {
        await act(() => root.render(<Feed count={0} />));
        await act(() => root.render(<Feed count={2} />));
        expect(merge).toHaveBeenCalledTimes(2);
      }
    } finally {
      Date.now = originalNow;
      await act(() => root.unmount());
      host.remove();
    }
  }
);
