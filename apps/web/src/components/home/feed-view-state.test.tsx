import { afterAll, afterEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { externalPostView } from "@/lib/posts/presentation";

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: mock() }),
}));
mock.module("@/components/home/feedview/post-card", () => ({
  default: ({ post }: { post: { id: string } }) => (
    <div data-post-id={post.id}>{post.id}</div>
  ),
}));
mock.module("@/components/protocols/bluesky-post-card", () => ({
  BlueskyPostCard: () => null,
}));
mock.module("@/components/recommendations/recommendation-tracker", () => ({
  RecommendationTracker: ({ children }: { children: ReactNode }) => children,
}));
const { FeedView } = await import("./feed-view");

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

const source: ExternalPost = {
  author: {
    displayName: "Author",
    handle: "author.test",
    id: "did:plc:author",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:author",
  },
  createdAt: "2026-10-18T10:00:00.000Z",
  id: "at://did:plc:author/app.bsky.feed.post/fixture",
  indexedAt: "2026-10-18T10:00:00.000Z",
  labels: [],
  languages: ["en"],
  media: [],
  revision: "revision",
  segments: [{ text: "Fixture" }],
  source: "bluesky",
  text: "Fixture",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/did:plc:author/post/fixture",
};
const post = (id: string) => ({
  ...externalPostView(source),
  external: undefined,
  id,
});

function createFeed() {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const client = new QueryClient();
  cleanups.push(async () => {
    await act(() => root.unmount());
    client.clear();
    host.remove();
  });
  return {
    client,
    ids: () =>
      [...host.querySelectorAll("[data-post-id]")].map(
        (node) => node.dataset.postId
      ),
    render: (
      posts: ReturnType<typeof post>[],
      cacheKey = ["post-feed", "latest"]
    ) =>
      act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <FeedView
              cacheKey={cacheKey}
              posts={posts}
              source="asm"
              sortBy="server"
            />
          </QueryClientProvider>
        )
      ),
  };
}

test("an empty incoming feed clears posts from the previous feed immediately", async () => {
  const feed = createFeed();
  await feed.render([post("latest")]);
  expect(feed.ids()).toEqual(["latest"]);
  await feed.render([], ["post-feed", "trending"]);
  expect(feed.ids()).toEqual([]);
});

test("pagination is adopted immediately even when the first post stays the same", async () => {
  const feed = createFeed();
  const first = post("first");
  await feed.render([first]);
  await feed.render([first, post("next")]);
  expect(feed.ids()).toEqual(["first", "next"]);
});

test("a queued cache update from the outgoing feed cannot overwrite the incoming feed", async () => {
  const feed = createFeed();
  const latestKey = ["post-feed", "latest"];
  const latest = post("latest");
  await feed.render([latest], latestKey);
  await act(async () => {
    feed.client.setQueryData(latestKey, {
      pages: [{ posts: [latest, post("late-latest")] }],
    });
    await feed.render([post("trending")], ["post-feed", "trending"]);
    await Bun.sleep(5);
  });
  expect(feed.ids()).toEqual(["trending"]);
  await act(async () => {
    feed.client.setQueryData(latestKey, {
      pages: [{ posts: [post("even-later-latest")] }],
    });
    await Bun.sleep(5);
  });
  expect(feed.ids()).toEqual(["trending"]);
});
