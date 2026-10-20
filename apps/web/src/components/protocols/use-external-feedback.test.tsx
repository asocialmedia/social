import { afterAll, afterEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { externalFeedbackKey } from "@asm/protocols/discovery";
import { Window } from "happy-dom";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

const toast = mock();
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: "viewer" } }),
}));
mock.module("@/lib/gooey-toast", () => ({ useToast: () => ({ toast }) }));
mock.module("@/components/recommendations/recommendation-tracker", () => ({
  trackNetworkAction: mock(),
}));
const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  localStorage: dom.localStorage,
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
const { useExternalFeedback } = await import("./use-external-feedback");
const { useFeedSourceStore } = await import("@/store/feed-source-store");
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  toast.mockClear();
  useFeedSourceStore.setState({ excluded: {} });
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
const post: ExternalPost = {
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
  id: "at://did:plc:alice/app.bsky.feed.post/example",
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
};

test.each(["post", "author"] as const)(
  "%s feedback hides immediately and restores the item after a rejected save",
  async (scope) => {
    const response = Promise.withResolvers<Response>();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: mock(() => response.promise),
      writable: true,
    });
    let feedback: ReturnType<typeof useExternalFeedback> | undefined;
    function Probe() {
      const action = useExternalFeedback(post);
      useEffect(() => {
        feedback = action;
      });
      return null;
    }
    const host = dom.document.createElement("div");
    const root = createRoot(host as unknown as HTMLElement);
    try {
      await act(() => root.render(<Probe />));
      const saving = feedback?.(scope);
      const key = externalFeedbackKey({
        authorId: post.author.id,
        postId: post.id,
        scope,
      });
      expect(useFeedSourceStore.getState().excluded.viewer?.has(key)).toBe(
        true
      );
      await act(async () => {
        response.resolve(new Response(null, { status: 503 }));
        await saving;
      });
      expect(useFeedSourceStore.getState().excluded.viewer?.has(key)).toBe(
        false
      );
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      );
    } finally {
      await act(() => root.unmount());
    }
  }
);
