import { expect, mock, test } from "bun:test";

import { renderToReadableStream } from "react-dom/server";

mock.module("@/components/discover/explore-client", () => ({
  default: () => <p>Explore</p>,
}));
mock.module("@/components/layouts/skeletons/explore-page-skeleton", () => ({
  default: () => <p>Loading exploration</p>,
}));

const { default: DiscoveryPage } = await import("./page");

test("discovery renders Explore without the public network sidebar", async () => {
  const stream = await renderToReadableStream(<DiscoveryPage />);
  await stream.allReady;

  const html = await new Response(stream).text();
  expect(html).toContain("Explore");
  expect(html).not.toContain("Across the open social web");
  expect(html).not.toContain("/network/bluesky");
});
