import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";

import {
  clearFeedTopRequest,
  requestFeedTop,
} from "@/lib/posts/feed-top-request";
import { useFeedPositionStore } from "@/store/feed-position-store";

import { useFeedScrollMemory } from "./use-feed-scroll-memory";

const dom = new Window({ url: "http://localhost:3000" });
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  cancelAnimationFrame: (id: number) => frames.delete(id),
  document: dom.document,
  requestAnimationFrame: (frameHandler: FrameRequestCallback) => {
    frameId += 1;
    frames.set(frameId, frameHandler);
    return frameId;
  },
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

const cleanups: (() => Promise<void>)[] = [];
beforeEach(async () => {
  clearFeedTopRequest();
  await useFeedPositionStore.persist.rehydrate();
  useFeedPositionStore.getState().resetFeedPositions();
  frames.clear();
});
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  frames.clear();
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

function Feed({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFeedScrollMemory({ containerRef: ref, memoryKey: name });
  return (
    <div
      data-scroller
      ref={(node) => {
        ref.current = node;
        if (!node) {
          return;
        }
        Object.defineProperties(node, {
          clientHeight: { configurable: true, value: 600 },
          getBoundingClientRect: {
            configurable: true,
            value: () => ({ bottom: 600, top: 0 }),
          },
          scrollHeight: { configurable: true, value: 6000 },
          scrollTo: {
            configurable: true,
            value: ({ top }: { top: number }) => {
              node.scrollTop = top;
            },
          },
        });
      }}
    >
      <div
        data-post-id={`${name}-post`}
        ref={(node) => {
          if (node) {
            Object.defineProperty(node, "getBoundingClientRect", {
              configurable: true,
              value: () => ({
                bottom: 6000 - (ref.current?.scrollTop ?? 0),
                top: -(ref.current?.scrollTop ?? 0),
              }),
            });
          }
        }}
      >
        Posts for {name}
      </div>
    </div>
  );
}

function createFeed() {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  cleanups.push(async () => {
    await act(() => root.unmount());
    host.remove();
  });
  return {
    container: () => host.querySelector("[data-scroller]"),
    flushFrames: () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        for (const frameHandler of pending) {
          frameHandler(performance.now());
        }
      }),
    render: (name: string) => act(() => root.render(<Feed name={name} />)),
    scroll: (top: number) =>
      act(() => {
        const container = host.querySelector("[data-scroller]");
        if (container) {
          container.scrollTop = top;
          container.dispatchEvent(new dom.Event("scroll"));
        }
      }),
  };
}

test("a rapid tab switch saves the outgoing offset before the next tab replaces its DOM", async () => {
  const feed = createFeed();
  await feed.render("latest");
  await feed.scroll(730);
  await feed.render("trending");
  expect(useFeedPositionStore.getState().positions.latest?.scrollTop).toBe(730);
  expect(
    useFeedPositionStore.getState().positions.latest?.anchorPostId
  ).not.toBe("trending-post");
  expect(feed.container()?.scrollTop).toBe(0);
  await feed.scroll(310);
  await feed.render("latest");
  expect(feed.container()?.scrollTop).toBe(730);
  expect(useFeedPositionStore.getState().positions.trending?.scrollTop).toBe(
    310
  );
});

test("an outgoing anchor is never overwritten with a post from the incoming tab", async () => {
  const feed = createFeed();
  await feed.render("latest");
  await feed.scroll(850);
  await act(() => dom.dispatchEvent(new dom.Event("pagehide")));
  expect(useFeedPositionStore.getState().positions.latest?.anchorPostId).toBe(
    "latest-post"
  );
  await feed.render("trending");
  expect(useFeedPositionStore.getState().positions.latest?.anchorPostId).toBe(
    "latest-post"
  );
  await feed.render("latest");
  expect(feed.container()?.scrollTop).toBe(850);
});

test("user input takes over from a pending restore instead of fighting the reader", async () => {
  useFeedPositionStore.getState().saveFeedPosition("latest", {
    anchorOffset: 0,
    anchorPostId: null,
    scrollTop: 1500,
    updatedAt: Date.now(),
  });
  const feed = createFeed();
  await feed.render("latest");
  expect(feed.container()?.scrollTop).toBe(1500);
  await act(() => feed.container()?.dispatchEvent(new dom.Event("wheel")));
  await feed.scroll(400);
  await feed.flushFrames();
  expect(feed.container()?.scrollTop).toBe(400);
});

test("reselecting the visible source-scoped tab cancels restoration and scrolls its own container", async () => {
  const key = "home:latest:bluesky:en";
  useFeedPositionStore.getState().saveFeedPosition(key, {
    anchorOffset: 0,
    anchorPostId: null,
    scrollTop: 1600,
    updatedAt: Date.now(),
  });
  const feed = createFeed();
  await feed.render(key);
  expect(feed.container()?.scrollTop).toBe(1600);
  await act(() => requestFeedTop("home:latest"));
  expect(feed.container()?.scrollTop).toBe(0);
  await feed.flushFrames();
  expect(feed.container()?.scrollTop).toBe(0);
});
