import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { LinkEmbedCard } from "./message-link-embed";

function render(url: string, failed = false) {
  const client = new QueryClient();
  if (failed) {
    client.setQueryData(["message-link-embed", url], null);
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LinkEmbedCard compact mine={false} url={url} />
    </QueryClientProvider>
  );
}

test("missing metadata keeps a fixed-height clickable link", () => {
  const html = render("https://react.dev/", true);
  expect(html).toContain('href="https://react.dev/"');
  expect(html).toContain("h-28");
});

test("YouTube playback is present before metadata loads and after metadata failure", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  for (const failed of [false, true]) {
    const html = render(url, failed);
    expect(html).toContain("Play video:");
    expect(html).toContain("h-50");
  }
});
