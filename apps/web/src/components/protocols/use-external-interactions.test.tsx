// Async network fixtures stay unresolved until optimistic UI has been inspected.
// oxlint-disable promise/avoid-new
import { afterAll, afterEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

mock.module("@/hooks/auth/use-require-auth", () => ({
  useRequireAuth: () => ({
    goToLogin: mock(),
    isLoggedIn: true,
    user: { id: "alice" },
  }),
}));
const toast = mock();
mock.module("@/lib/gooey-toast", () => ({ useToast: () => ({ toast }) }));
mock.module("@/components/recommendations/recommendation-tracker", () => ({
  trackNetworkAction: mock(),
}));
const { useExternalInteractions } = await import("./use-external-interactions");
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
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  toast.mockClear();
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
const uri = "at://did:plc:alice/app.bsky.feed.post/example";
const initial = {
  amplifications: 0,
  amplified: false,
  bookmarked: false,
  comments: 0,
};
const post = {
  asm: initial,
  author: {
    displayName: "Alice",
    handle: "alice.bsky.social",
    id: "did:plc:alice",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:alice",
  },
  createdAt: "2026-10-20T00:00:00Z",
  id: uri,
  indexedAt: "2026-10-20T00:00:00Z",
  labels: [],
  languages: [],
  media: [],
  revision: "cid",
  segments: [{ text: "Hello" }],
  source: "bluesky",
  text: "Hello",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/did:plc:alice/post/example",
} satisfies ExternalPost;
const pause = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 10);
  });

test.each([
  { action: "amplify" as const, status: 503 },
  { action: "bookmark" as const, status: 503 },
  { action: "amplify" as const, status: 200 },
  { action: "bookmark" as const, status: 200 },
])(
  "$action shares optimistic state and handles a $status response with feedback",
  async ({ action, status }) => {
    const client = new QueryClient();
    const nextPost = { ...post, id: `${uri}-next` };
    const page = Promise.withResolvers<{ items: (typeof post)[] }>();
    let pageSignal: AbortSignal | undefined;
    const feedKey = ["bluesky-discovery", "latest", "alice"];
    const feed = new QueryObserver(client, {
      initialData: { items: [post] },
      queryFn: ({ signal }) => {
        pageSignal = signal;
        return page.promise;
      },
      queryKey: feedKey,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = feed.subscribe(() => {});
    const query = client.getQueryCache().find({ queryKey: feedKey });
    const nextPage = query?.fetch(undefined, {
      meta: { fetchMore: { direction: "forward" } },
    });
    const parent = Promise.withResolvers<{ id: string }>();
    let parentSignal: AbortSignal | undefined;
    const parentKey = ["external-post", "unrelated-parent", "alice"];
    const parentRead = client.fetchQuery({
      queryFn: ({ signal }) => {
        parentSignal = signal;
        return parent.promise;
      },
      queryKey: parentKey,
    });
    const host = dom.document.createElement("div");
    const root = createRoot(host as unknown as HTMLElement);
    let respond: ((response: Response) => void) | undefined;
    const waiting = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: mock(() => waiting),
      writable: true,
    });
    let control: ReturnType<typeof useExternalInteractions> | undefined;
    function Probe() {
      const interaction = useExternalInteractions(post);
      useEffect(() => {
        control = interaction;
      });
      return (
        <span data-pending={String(interaction.pending)}>
          {String(
            action === "amplify"
              ? interaction.state.amplified
              : interaction.state.bookmarked
          )}
        </span>
      );
    }
    try {
      await act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
            <Probe />
          </QueryClientProvider>
        )
      );
      let mutation: Promise<boolean> | undefined;
      await act(async () => {
        mutation = control?.mutate({ action, active: true, uri });
        await pause();
      });
      expect(
        [...host.querySelectorAll("span")].map((node) => node.textContent)
      ).toEqual(["true", "true"]);
      expect(
        [...host.querySelectorAll("span")].map((node) => node.dataset.pending)
      ).toEqual(["true", "true"]);
      expect(parentSignal?.aborted).toBe(false);
      expect(pageSignal?.aborted).toBe(false);
      expect(client.getQueryState(parentKey)?.fetchStatus).toBe("fetching");
      expect(await control?.mutate({ action, active: false, uri })).toBe(false);
      await act(async () => {
        respond?.(
          Response.json(
            status === 200
              ? {
                  ...initial,
                  amplifications: action === "amplify" ? 1 : 0,
                  amplified: action === "amplify",
                  bookmarked: action === "bookmark",
                }
              : { error: "Unavailable" },
            { status }
          )
        );
        await mutation;
        await pause();
      });
      expect(
        [...host.querySelectorAll("span")].map((node) => node.textContent)
      ).toEqual(status === 200 ? ["true", "true"] : ["false", "false"]);
      expect(
        [...host.querySelectorAll("span")].map((node) => node.dataset.pending)
      ).toEqual(["false", "false"]);
      expect(pageSignal?.aborted).toBe(false);
      page.resolve({ items: [post, nextPost] });
      await nextPage;
      await act(pause);
      expect(client.getQueryData(feedKey)).toMatchObject({
        items: [
          {
            ...post,
            asm: {
              ...initial,
              amplifications: status === 200 && action === "amplify" ? 1 : 0,
              amplified: status === 200 && action === "amplify",
              bookmarked: status === 200 && action === "bookmark",
            },
          },
          nextPost,
        ],
      });
      expect(
        client.getQueryData(["external-interaction", "alice", uri])
      ).toEqual(
        status === 200
          ? {
              ...initial,
              amplifications: action === "amplify" ? 1 : 0,
              amplified: action === "amplify",
              bookmarked: action === "bookmark",
            }
          : initial
      );
      if (status === 200) {
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: action === "amplify" ? "+1 Aura" : "Bookmarked",
          })
        );
      } else {
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: "destructive" })
        );
      }
    } finally {
      page.resolve({ items: [post, nextPost] });
      await nextPage;
      unsubscribe();
      parent.resolve({ id: "unrelated-parent" });
      await parentRead;
      await act(() => root.unmount());
      client.clear();
    }
  }
);
