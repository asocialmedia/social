import { describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";

import {
  LinkBadge,
  MAX_INLINE_LINK_PREVIEWS,
} from "@/components/posts/link-badge";

import Linkify from "./linkify";

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToString(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("Linkify and URL punctuation extraction", () => {
  test("strips trailing period from URL", () => {
    const html = renderWithQuery(<Linkify>Check https://example.com.</Linkify>);
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('href="https://example.com."');
    expect(html).toContain("example.com");
  });

  test("strips trailing comma from URL", () => {
    const html = renderWithQuery(
      <Linkify>Visit https://example.com, and explore</Linkify>
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('href="https://example.com,"');
  });

  test("strips trailing exclamation and question marks", () => {
    const html1 = renderWithQuery(
      <Linkify>Awesome https://example.com!</Linkify>
    );
    expect(html1).toContain('href="https://example.com"');
    expect(html1).not.toContain('href="https://example.com!"');

    const html2 = renderWithQuery(
      <Linkify>Is this https://example.com?</Linkify>
    );
    expect(html2).toContain('href="https://example.com"');
    expect(html2).not.toContain('href="https://example.com?"');
  });

  test("strips trailing unclosed parenthesis but keeps surrounding text", () => {
    const html = renderWithQuery(
      <Linkify>(see https://example.com/docs)</Linkify>
    );
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).not.toContain('href="https://example.com/docs)"');
  });

  test("preserves balanced internal parentheses (e.g. Wikipedia)", () => {
    const html = renderWithQuery(
      <Linkify>https://en.wikipedia.org/wiki/React_(software)</Linkify>
    );
    expect(html).toContain(
      'href="https://en.wikipedia.org/wiki/React_(software)"'
    );
  });

  test("strips trailing quotation marks", () => {
    const htmlDouble = renderWithQuery(
      <Linkify>Check out "https://example.com"</Linkify>
    );
    expect(htmlDouble).toContain('href="https://example.com"');
    expect(htmlDouble).not.toContain('href="https://example.com&quot;"');

    const htmlSingle = renderWithQuery(
      <Linkify>Check out 'https://example.com'</Linkify>
    );
    expect(htmlSingle).toContain('href="https://example.com"');
    expect(htmlSingle).not.toContain('href="https://example.com&#x27;"');
  });
});

describe("LinkBadge bounded preview limit", () => {
  test("renders link badge correctly with host label", () => {
    const html = renderWithQuery(
      <LinkBadge index={0} url="https://github.com/foo/bar" />
    );
    expect(html).toContain('href="https://github.com/foo/bar"');
    expect(html).toContain("github.com");
  });

  test("respects maxPreviews cap", () => {
    const htmlUnderCap = renderWithQuery(
      <LinkBadge
        index={0}
        maxPreviews={MAX_INLINE_LINK_PREVIEWS}
        url="https://example.com"
      />
    );
    expect(htmlUnderCap).toContain('href="https://example.com"');

    const htmlOverCap = renderWithQuery(
      <LinkBadge
        index={10}
        maxPreviews={MAX_INLINE_LINK_PREVIEWS}
        url="https://example.com"
      />
    );
    expect(htmlOverCap).toContain('href="https://example.com"');
  });
});
