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
  BlueskyPostCard: ({ post }: { post: ExternalPost }) => (
    <div data-post-id={post.id}>{post.id}</div>
  ),
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
      cacheKey = ["post-feed", "latest"],
      trending = false,
      options: {
        external?: ExternalPost[];
        sourcesPending?: boolean;
        sourceWaitMs?: number;
        source?: "all" | "asm";
      } = {}
    ) =>
      act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <FeedView
              cacheKey={cacheKey}
              posts={posts}
              externalPosts={options.external}
              sourcesPending={options.sourcesPending}
              sourceWaitMs={options.sourceWaitMs}
              source={options.source ?? "asm"}
              sortBy="server"
              trending={trending}
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

test("Trending rejects quiet cached cards and cache updates even when their old scores are huge", async () => {
  const feed = createFeed();
  const quiet = { ...post("quiet"), aura: 1_000_000, trendingScore: 1_000_000 };
  const active = {
    ...post("active"),
    _count: { ...post("active")._count, vote: 10 },
  };
  const key = ["post-feed", "trending"];
  await feed.render([quiet, active], key, true);
  expect(feed.ids()).toEqual(["active"]);
  await act(async () => {
    feed.client.setQueryData(key, {
      pages: [{ posts: [quiet, active, post("new-but-quiet")] }],
    });
    await Bun.sleep(5);
  });
  expect(feed.ids()).toEqual(["active"]);
  await feed.render([quiet, active], ["post-feed", "latest"]);
  expect(feed.ids()).toEqual(["quiet", "active"]);
});

test("pagination is adopted immediately even when the first post stays the same", async () => {
  const feed = createFeed();
  const first = post("first");
  await feed.render([first]);
  await feed.render([first, post("next")]);
  expect(feed.ids()).toEqual(["first", "next"]);
});

test("revealing a mixed buffered head prepends actual rendered cards and preserves the old tail", async () => {
  const feed = createFeed();
  const key = ["post-feed", "latest"];
  const first = post("first");
  const older = post("older");
  const remote = { ...source, id: `${source.id}-first` };
  await feed.render([first, older], key, false, {
    external: [remote],
    source: "all",
  });
  const tail = feed.ids();
  const fresh = post("fresh");
  const remoteHead = { ...source, id: `${source.id}-head` };
  await feed.render([fresh, first, older], key, false, {
    external: [remoteHead, remote],
    source: "all",
  });
  expect(new Set(feed.ids().slice(0, 2))).toEqual(
    new Set([fresh.id, remoteHead.id])
  );
  expect(feed.ids().slice(2)).toEqual(tail);
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

test("mixed sources stage a page-sized arrival until both peers finish, then interleave it", async () => {
  const feed = createFeed();
  const native = Array.from({ length: 10 }, (_, index) =>
    post(`native-${index}`)
  );
  const external = Array.from({ length: 20 }, (_, index) => ({
    ...source,
    id: `${source.id}${index}`,
  }));
  const key = ["post-feed", "for-you"];
  await feed.render(native, key, false, {
    source: "all",
    sourcesPending: true,
  });
  expect(feed.ids()).toEqual(["native-0"]);
  await feed.render(native, key, false, {
    external,
    source: "all",
    sourcesPending: false,
  });
  expect(feed.ids().slice(0, 5)).toEqual([
    "native-0",
    external[0].id,
    external[1].id,
    "native-1",
    external[2].id,
  ]);
  const before = feed.ids();
  const moreNative = [
    ...native,
    ...Array.from({ length: 5 }, (_, index) => post(`next-${index}`)),
  ];
  await feed.render(moreNative, key, false, {
    external,
    source: "all",
    sourcesPending: true,
  });
  expect(feed.ids()).toEqual(before);
  const moreExternal = [
    ...external,
    ...Array.from({ length: 10 }, (_, index) => ({
      ...source,
      id: `${source.id}next${index}`,
    })),
  ];
  await feed.render(moreNative, key, false, {
    external: moreExternal,
    source: "all",
    sourcesPending: false,
  });
  expect(feed.ids().slice(before.length, before.length + 4)).toEqual([
    "next-0",
    moreExternal[20].id,
    moreExternal[21].id,
    "next-1",
  ]);
});

test("a slow or continually paging peer cannot keep successfully loaded posts staged forever", async () => {
  const feed = createFeed();
  const native = Array.from({ length: 6 }, (_, index) =>
    post(`healthy-${index}`)
  );
  await feed.render(native, ["post-feed", "bounded-stage"], false, {
    source: "all",
    sourcesPending: true,
  });
  expect(feed.ids()).toHaveLength(1);
  await act(async () => {
    await Bun.sleep(650);
  });
  expect(feed.ids()).toEqual(native.map((item) => item.id));
  await feed.render(
    [...native, post("next-page")],
    ["post-feed", "bounded-stage"],
    false,
    { source: "all", sourcesPending: true }
  );
  expect(feed.ids()).toContain("next-page");
});

test("Following keeps a slow first page staged beyond the discovery grace period and mixes it when ready", async () => {
  const feed = createFeed();
  const native = Array.from({ length: 10 }, (_, index) =>
    post(`followed-native-${index}`)
  );
  const remote = Array.from({ length: 20 }, (_, index) => ({
    ...source,
    id: `${source.id}followed-${index}`,
  }));
  const key = ["post-feed", "following"];
  await feed.render(native, key, false, {
    source: "all",
    sourceWaitMs: 18_000,
    sourcesPending: true,
  });
  await act(async () => {
    await Bun.sleep(750);
  });
  expect(feed.ids()).toEqual(["followed-native-0"]);
  await feed.render(native, key, false, {
    external: remote,
    source: "all",
    sourceWaitMs: 18_000,
    sourcesPending: false,
  });
  expect(feed.ids().slice(0, 7)).toEqual([
    native[0]?.id,
    remote[0]?.id,
    remote[1]?.id,
    native[1]?.id,
    remote[2]?.id,
    remote[3]?.id,
    native[2]?.id,
  ]);
});

test("Following releases healthy native posts when the remote request fails", async () => {
  const feed = createFeed();
  const native = [post("followed-healthy-1"), post("followed-healthy-2")];
  const key = ["post-feed", "following-failed"];
  await feed.render(native, key, false, {
    source: "all",
    sourceWaitMs: 18_000,
    sourcesPending: true,
  });
  await feed.render(native, key, false, {
    source: "all",
    sourceWaitMs: 18_000,
    sourcesPending: false,
  });
  expect(feed.ids()).toEqual(native.map((item) => item.id));
});

test("a custom source deadline releases posts even if a request never settles", async () => {
  const feed = createFeed();
  const native = [post("deadline-1"), post("deadline-2")];
  await feed.render(native, ["post-feed", "following-deadline"], false, {
    source: "all",
    sourceWaitMs: 30,
    sourcesPending: true,
  });
  expect(feed.ids()).toEqual(["deadline-1"]);
  await act(async () => {
    await Bun.sleep(60);
  });
  expect(feed.ids()).toEqual(["deadline-1", "deadline-2"]);
});
