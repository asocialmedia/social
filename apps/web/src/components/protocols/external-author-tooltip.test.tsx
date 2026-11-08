import { expect, mock, test } from "bun:test";

import type { ExternalAuthor } from "@asm/protocols/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";

let desktop = false;
mock.module("@/hooks/use-media-query", () => ({
  useMediaQuery: () => desktop,
}));
const { ExternalAuthorTooltip } = await import("./external-author-tooltip");
const author: ExternalAuthor = {
  displayName: "Writer",
  handle: "writer.test",
  id: "did:plc:writer",
  labels: [],
  source: "bluesky",
  upstreamCounts: {},
  url: "https://bsky.app/profile/did:plc:writer",
};

test.each([false, true])(
  "desktop=%s retains the author trigger and mounts only its own behavior",
  (wide) => {
    desktop = wide;
    const client = new QueryClient();
    try {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <ExternalAuthorTooltip author={author}>
            <Link href="/writer">Writer</Link>
          </ExternalAuthorTooltip>
        </QueryClientProvider>
      );
      expect(html).toContain('href="/writer"');
      expect(html).toContain("Writer");
      expect(
        client.getQueryCache().findAll({ queryKey: ["bluesky-author-preview"] })
      ).toHaveLength(wide ? 1 : 0);
    } finally {
      client.clear();
    }
  }
);
