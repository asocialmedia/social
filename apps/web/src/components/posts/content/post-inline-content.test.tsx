import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { PostInlineContent } from "./post-inline-content";

function render(
  content: string,
  sourceSegments?: { text: string; href?: string }[]
) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostInlineContent
        content={content}
        sourceSegments={sourceSegments}
        embeds={[
          {
            title: "A readable article",
            type: "link",
            url: "https://example.com/story",
          },
        ]}
      />
    </QueryClientProvider>
  );
  client.clear();
  return html;
}

test("Bluesky facets share native tag and link pills while mentions preserve their DID", () => {
  const html = render("#science @scientist.bsky.social example.com/story", [
    { text: "#science " },
    {
      href: "https://bsky.app/profile/did%3Aplc%3Aexample",
      text: "@scientist.bsky.social",
    },
    { text: " " },
    { href: "https://example.com/story", text: "example.com/story" },
  ]);
  expect(html).toContain("meta-chip-tag");
  expect(html).toContain("meta-chip-mention");
  expect(html).toContain("/network/bluesky/profile?actor=did%3Aplc%3Aexample");
  expect(html).not.toContain("/users/scientist");
  expect(html).toContain("A readable article");
});

test("native mentions and tags retain their own destinations", () => {
  const html = render("#science @native");
  expect(html).toContain("/users/native");
  expect(html).toContain("/hashtag/science");
});

test("unfaceted source hashtags retain Unicode text and full handles stay on the source network", () => {
  const html = render("#自然 @artist.bsky.social", [
    { text: "#自然 @artist.bsky.social" },
  ]);
  expect(html).toContain("meta-chip-tag");
  expect(html).toContain("自然");
  expect(html).toContain("/network/bluesky/profile?actor=artist.bsky.social");
  expect(html).not.toContain("/users/artist");
});
