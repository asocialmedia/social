import { afterAll, expect, test } from "bun:test";

import type { PostsPage } from "@asm/db";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { revealFeedHead, prependPostsToFeedCache } from "./feed-cache";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
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

const queryKey = ["post-feed", "reveal-regression"];
const post = (id: string) => ({ id }) as unknown as PostsPage["posts"][number];

function Feed() {
  const client = useQueryClient();
  const query = useInfiniteQuery({
    getNextPageParam: (page: PostsPage) => page.nextCursor,
    initialPageParam: null as string | null,
    queryFn: (): Promise<PostsPage> =>
      Promise.resolve({ nextCursor: null, posts: [post("old")] }),
    queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [hasBadge, setHasBadge] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      {hasBadge ? (
        <button
          type="button"
          onClick={() =>
            revealFeedHead(ref.current, () => {
              setHasBadge(false);
              prependPostsToFeedCache(client, queryKey, [post("new")]);
            })
          }
        >
          Reveal new posts
        </button>
      ) : null}
      {query.data?.pages
        .flatMap((page) => page.posts)
        .map((item) => (
          <article key={item.id} data-feed-item>
            {item.id}
          </article>
        ))}
    </div>
  );
}

test("new feed cards are committed before the pill starts scrolling the overflow container", async () => {
  const scroll = dom.document.createElement("div");
  scroll.style.overflowY = "auto";
  scroll.scrollTop = 1200;
  Object.defineProperty(scroll, "clientHeight", { value: 600 });
  Object.defineProperty(scroll, "scrollHeight", { value: 3000 });
  dom.document.body.append(scroll);
  const host = dom.document.createElement("div");
  scroll.append(host);
  let firstAtScroll: string | null = null;
  let badgeAtScroll = true;
  Object.defineProperty(scroll, "scrollTo", {
    value: () => {
      firstAtScroll = scroll.querySelector("article")?.textContent ?? null;
      badgeAtScroll = Boolean(scroll.querySelector("button"));
      scroll.scrollTop = 0;
    },
  });
  const root = createRoot(host as unknown as HTMLElement);
  const client = new QueryClient();
  client.setQueryData<InfiniteData<PostsPage, string | null>>(queryKey, {
    pageParams: [null],
    pages: [{ nextCursor: null, posts: [post("old")] }],
  });
  try {
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Feed />
        </QueryClientProvider>
      )
    );
    await act(() => {
      scroll.querySelector("button")?.click();
    });
    expect(firstAtScroll).toBe("new");
    expect(badgeAtScroll).toBe(false);
    expect(scroll.scrollTop).toBe(0);
  } finally {
    await act(() => root.unmount());
    client.clear();
    scroll.remove();
  }
});
