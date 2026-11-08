import { expect, mock, test } from "bun:test";

import { renderToReadableStream } from "react-dom/server";

const requestConnection = Promise.withResolvers<undefined>();
const discoveryPost = {
  author: { handle: "example.bsky.social" },
  id: "at://did:plc:example/app.bsky.feed.post/123",
  text: "A public conversation.",
};
const getPublicBlueskyDiscovery = mock(() => Promise.resolve([discoveryPost]));

mock.module("next/server", () => ({
  connection: () => requestConnection.promise,
}));
mock.module("@/lib/seo/bluesky-discovery", () => ({
  getPublicBlueskyDiscovery,
}));
mock.module("@/components/discover/explore-client", () => ({
  default: () => <p>Explore</p>,
}));
mock.module("@/components/layouts/skeletons/explore-page-skeleton", () => ({
  default: () => <p>Loading exploration</p>,
}));

const { default: DiscoveryPage } = await import("./page");

test("discovery defers its database-backed snippets until a request connects", async () => {
  const stream = await renderToReadableStream(<DiscoveryPage />);

  expect(getPublicBlueskyDiscovery).not.toHaveBeenCalled();

  requestConnection.resolve();
  await stream.allReady;

  expect(getPublicBlueskyDiscovery).toHaveBeenCalledTimes(1);
  const html = await new Response(stream).text();
  expect(html).toContain("Explore");
  expect(html).toContain(discoveryPost.author.handle);
  expect(html).toContain(discoveryPost.text);
  expect(html).toContain(
    'href="/network/bluesky?uri=at%3A%2F%2Fdid%3Aplc%3Aexample%2Fapp.bsky.feed.post%2F123"'
  );
});
