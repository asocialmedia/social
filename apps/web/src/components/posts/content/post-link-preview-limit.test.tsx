import { expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

mock.module("../embeds/link-badge", () => ({
  LinkBadge: ({ index, url }: { index: number; url: string }) => (
    <a data-preview-index={index} href={url}>
      Shop destination
    </a>
  ),
  findEmbedForUrl: () => {},
  hostLabel: (url: string) => new URL(url).hostname,
}));
const { PostInlineContent } = await import("./post-inline-content");

test("text fragments do not consume the five-link preview allowance", () => {
  const html = renderToStaticMarkup(
    <PostInlineContent
      content=""
      sourceSegments={[
        ...Array.from({ length: 6 }, () => ({ text: "A fragment " })),
        { href: "https://ko-fi.com/s/8b62fc25c7", text: "Product" },
        { text: " and " },
        { href: "https://ko-fi.com/tidalcraftfox/shop/open", text: "Shop" },
      ]}
    />
  );
  expect(html).toContain('data-preview-index="0"');
  expect(html).toContain('data-preview-index="1"');
});
