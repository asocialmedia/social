import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

import { externalPostView } from "@/lib/posts/presentation";

mock.module("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: mock() }),
  useSearchParams: () => new URLSearchParams(),
}));
const { default: PostCard } = await import("./post-card");
const source: ExternalPost = {
  author: {
    displayName: "Reader",
    handle: "reader.test",
    id: "did:plc:reader",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:reader",
  },
  createdAt: "2026-11-07T10:00:00.000Z",
  id: "at://did:plc:reader/app.bsky.feed.post/fixture",
  indexedAt: "2026-11-07T10:00:00.000Z",
  labels: [],
  languages: ["en"],
  media: [],
  revision: "revision",
  segments: [{ text: "Readable before hydration" }],
  source: "bluesky",
  text: "Readable before hydration",
  upstreamCounts: {},
  url: "https://bsky.app/profile/did:plc:reader/post/fixture",
};

for (const network of ["asm", "bluesky"] as const) {
  test(`${network} feed content can paint before hydration while retaining its fade`, () => {
    const client = new QueryClient();
    const dom = new Window();
    try {
      dom.document.body.innerHTML = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <PostCard
            post={{
              ...externalPostView(source),
              external: network === "bluesky" ? source : undefined,
            }}
            isJoined
          />
        </QueryClientProvider>
      );
      const card = dom.document.querySelector("article[data-post-id]");
      expect(card?.textContent).toContain("Readable before hydration");
      expect(card?.classList.contains("fade-in")).toBe(true);
      expect(card?.classList.contains("[animation-duration:300ms]")).toBe(true);
      expect(card?.classList.contains("motion-reduce:animate-none")).toBe(true);
      expect(card?.getAttribute("style")).toBeNull();
    } finally {
      client.clear();
      dom.close();
    }
  });
}
