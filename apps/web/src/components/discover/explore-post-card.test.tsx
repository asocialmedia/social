import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import type { LinkEmbed } from "@/lib/link-embeds/shared";

import { ExplorePostEmbed, embedImageUrl } from "./explore-post-card";

const youtubeEmbed: LinkEmbed = {
  description: "By JustZando",
  imageUrl: null,
  siteName: "YouTube",
  title: "Coding a Minecraft friend",
  type: "youtube",
  url: "https://youtu.be/KUAugyxGZvE",
  videoAuthor: "JustZando",
  videoId: "KUAugyxGZvE",
};

const linkWithImage: LinkEmbed = {
  description: "A song",
  imageUrl: "https://i.scdn.co/image/abc123",
  siteName: "Spotify",
  title: "Breezeblocks",
  type: "link",
  url: "https://open.spotify.com/track/1ZLroqJA8qoS5QEeCo0fA7",
};

const plainLink: LinkEmbed = {
  description: null,
  imageUrl: null,
  siteName: "Example",
  title: "A plain link with no preview image",
  type: "link",
  url: "https://example.com/thing",
};

describe("embedImageUrl", () => {
  test("derives the YouTube poster from the validated video id", () => {
    expect(embedImageUrl(youtubeEmbed)).toBe(
      "https://i.ytimg.com/vi/KUAugyxGZvE/hqdefault.jpg"
    );
  });

  test("rejects a malformed YouTube id rather than building a URL", () => {
    expect(embedImageUrl({ ...youtubeEmbed, videoId: "short" })).toBeNull();
    expect(embedImageUrl({ ...youtubeEmbed, videoId: null })).toBeNull();
  });

  test("uses the OG image for a generic link", () => {
    expect(embedImageUrl(linkWithImage)).toBe("https://i.scdn.co/image/abc123");
  });

  test("returns null for a link with no image", () => {
    expect(embedImageUrl(plainLink)).toBeNull();
  });
});

describe("ExplorePostEmbed", () => {
  test("renders a proxied YouTube thumbnail with the platform mark", () => {
    const html = renderToString(<ExplorePostEmbed embed={youtubeEmbed} />);
    // The raw remote URL must never reach the browser; it is proxied.
    expect(html).toContain("/api/link-preview/image?url=");
    expect(html).toContain(
      encodeURIComponent("https://i.ytimg.com/vi/KUAugyxGZvE/hqdefault.jpg")
    );
    expect(html).toContain("YouTube");
  });

  test("renders a proxied OG image for a generic link", () => {
    const html = renderToString(<ExplorePostEmbed embed={linkWithImage} />);
    expect(html).toContain("/api/link-preview/image?url=");
    expect(html).toContain(encodeURIComponent(linkWithImage.imageUrl ?? ""));
    expect(html).toContain("Spotify");
  });

  test("falls back to a titled text row when the embed has no image", () => {
    const html = renderToString(<ExplorePostEmbed embed={plainLink} />);
    // No image to show, so the tile must still name the link instead of
    // rendering an empty frame.
    expect(html).not.toContain("<img");
    expect(html).toContain("A plain link with no preview image");
    expect(html).toContain("Example");
  });
});
