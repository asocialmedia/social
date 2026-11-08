import { expect, mock, test } from "bun:test";

import { renderToReadableStream } from "react-dom/server";

const requestConnection = Promise.withResolvers<undefined>();
const getPublicBlueskyDiscovery = mock(() => Promise.resolve([]));

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
  expect(await new Response(stream).text()).toContain("Explore");
});
