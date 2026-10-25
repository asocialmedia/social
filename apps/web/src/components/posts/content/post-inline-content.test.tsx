import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

import { PostInlineContent } from "./post-inline-content";

function render(
  content: string,
  sourceSegments?: { text: string; href?: string }[],
  compactBlankLines = true,
  source?: "asm" | "bluesky"
) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostInlineContent
        compactBlankLines={compactBlankLines}
        content={content}
        sourceSegments={sourceSegments}
        source={source}
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

test.each(["ASM", "Bluesky"])(
  "%s post paragraphs use compact gaps while preserving text and single line breaks",
  (source) => {
    const content =
      "First line\nSecond line\n\nNext paragraph\r\n \t\r\nLast paragraph";
    const window = new Window();
    window.document.body.innerHTML = render(
      content,
      source === "Bluesky" ? [{ text: content }] : undefined
    );
    const prose = window.document.querySelector("p");
    expect(prose?.textContent).toBe(content);
    const gaps = prose?.querySelectorAll("span.block.h-2");
    expect(gaps?.length).toBe(2);
    expect(gaps?.[0]?.textContent).toBe("\n\n");
    expect(gaps?.[1]?.textContent).toBe("\r\n \t\r\n");
  }
);

test("compact paragraph gaps retain inline tags and links on either side", () => {
  const html = render("#science\n\nhttps://example.com/story\n\n@native");
  expect(html).toContain("/hashtag/science");
  expect(html).toContain("A readable article");
  expect(html).toContain("/users/native");
  expect(html.match(/class="block h-2 whitespace-normal"/g)).toHaveLength(2);
});

test("bios can retain their original blank-line spacing", () => {
  const html = render("First paragraph\n\nSecond paragraph", undefined, false);
  expect(html).toContain("First paragraph\n\nSecond paragraph");
  expect(html).not.toContain("block h-2");
});

test("Bluesky profile bios resolve complete handles inside ASM without local user lookups", () => {
  const html = render(
    "Made by @rauchg.com and @vercel.bsky.social. See https://vercel.com",
    undefined,
    true,
    "bluesky"
  );
  expect(html).toContain("/network/bluesky/profile?actor=rauchg.com");
  expect(html).toContain("/network/bluesky/profile?actor=vercel.bsky.social");
  expect(html).not.toContain("/users/");
  expect(html).toContain("https://vercel.com");
});

test("post facets and profile bio mention pills reuse the resolved Bluesky avatar", () => {
  const client = new QueryClient();
  const author = {
    avatarUrl:
      "https://cdn.bsky.app/img/avatar/plain/did:plc:scientist/avatar@jpeg",
    displayName: "Scientist",
    handle: "scientist.bsky.social",
    id: "did:plc:scientist",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:scientist",
  };
  client.setQueryData(["bluesky-profile", author.id], author);
  client.setQueryData(["bluesky-profile", author.handle], author);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PostInlineContent
        content="@scientist.bsky.social"
        sourceSegments={[
          {
            href: "https://bsky.app/profile/did:plc:scientist",
            text: "@scientist.bsky.social",
          },
        ]}
      />
      <PostInlineContent
        content="Research by @scientist.bsky.social"
        source="bluesky"
      />
    </QueryClientProvider>
  );
  expect(
    html.match(/avatar%40jpeg|avatar@jpeg/g)?.length
  ).toBeGreaterThanOrEqual(2);
  expect(html).not.toContain("/api/users/username/");
  expect(html).toContain("actor=did%3Aplc%3Ascientist");
  client.clear();
});

test("Bluesky link pills retain a human facet label and disambiguate multiple links on one host", () => {
  const html = render("My shop and product", [
    { href: "https://ko-fi.com/tidalcraftfox/shop/open", text: "My shop" },
    { text: " and " },
    { href: "https://ko-fi.com/s/8b62fc25c7", text: "ko-fi.com/s/8b62…" },
  ]);
  expect(html).toContain("My shop");
  expect(html).toContain("ko-fi.com/s/8b62fc25c7");
  expect(html).toContain('href="https://ko-fi.com/tidalcraftfox/shop/open"');
  expect(html).not.toContain(">ko-fi.com<");
});

test("a Bluesky URL in an unfaceted text segment still becomes a link pill", () => {
  const html = render("See my shop", [
    { text: "See https://ko-fi.com/s/8b62fc25c7" },
  ]);
  expect(html).toContain('href="https://ko-fi.com/s/8b62fc25c7"');
  expect(html).toContain("meta-chip");
});
