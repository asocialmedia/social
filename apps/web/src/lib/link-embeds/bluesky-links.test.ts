// oxlint-disable no-script-url -- Unsafe fixture URLs must be rejected.
import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { blueskyLinkPreviews, linkFallbackLabel } from "./bluesky-links";

const post: ExternalPost = {
  author: {
    displayName: "Artist",
    handle: "artist.bsky.social",
    id: "did:plc:artist",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/artist.bsky.social",
  },
  createdAt: "2026-10-25T00:00:00Z",
  id: "at://did:plc:artist/app.bsky.feed.post/example",
  indexedAt: "2026-10-25T00:00:00Z",
  labels: [],
  languages: [],
  media: [],
  revision: "cid",
  segments: [{ href: "https://ko-fi.com/s/8b62fc25c7", text: "My shop" }],
  source: "bluesky",
  text: "My shop",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/artist.bsky.social/post/example",
};

test("a Bluesky facet with no attached card has an immediate destination-only fallback", () => {
  expect(blueskyLinkPreviews(post, [])).toEqual([
    {
      siteName: "ko-fi.com",
      title: "My shop",
      type: "link",
      url: "https://ko-fi.com/s/8b62fc25c7",
    },
  ]);
});

test("truncated URL labels show the complete destination instead", () => {
  expect(
    linkFallbackLabel(
      "https://ko-fi.com/tidalcraftfox/shop/open",
      "ko-fi.com/tidal…"
    )
  ).toBe("ko-fi.com/tidalcraftfox/shop/open");
  expect(
    linkFallbackLabel(
      "https://ko-fi.com/s/8b62fc25c7",
      "https://ko-fi.com/s/8b62fc25c7"
    )
  ).toBe("ko-fi.com/s/8b62fc25c7");
});

test("upstream metadata prevents additional card resolution", () => {
  expect(
    blueskyLinkPreviews(post, [
      {
        title: "The actual product title",
        type: "link",
        url: "https://ko-fi.com/s/8b62fc25c7",
      },
    ])
  ).toEqual([]);
});

test("mention facets and unsafe links never become website cards", () => {
  expect(
    blueskyLinkPreviews(
      {
        ...post,
        segments: [
          {
            href: "https://bsky.app/profile/did:plc:artist",
            text: "@artist.bsky.social",
          },
          { href: "javascript:alert(1)", text: "unsafe" },
        ],
      },
      []
    )
  ).toEqual([]);
});

test("old posts without facets can still produce a card and extra URLs do not multiply cards", () => {
  const previews = blueskyLinkPreviews(
    {
      ...post,
      segments: [],
      text: "https://ko-fi.com/s/8b62fc25c7 https://ko-fi.com/tidalcraftfox/shop/open",
    },
    []
  );
  expect(previews).toHaveLength(1);
  expect(previews[0]?.url).toBe("https://ko-fi.com/s/8b62fc25c7");
});

test("an unfaceted URL beside a mention still gets a website preview", () => {
  const previews = blueskyLinkPreviews(
    {
      ...post,
      segments: [
        {
          href: "https://bsky.app/profile/did:plc:artist",
          text: "@artist.bsky.social",
        },
        { text: " see https://ko-fi.com/s/8b62fc25c7" },
      ],
    },
    []
  );
  expect(previews[0]?.url).toBe("https://ko-fi.com/s/8b62fc25c7");
});
