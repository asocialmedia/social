import { describe, expect, test } from "bun:test";

import type { LinkEmbed } from "@/features/feed/lib/link-embeds";

import { embedSiteLabel, selectPreviewEmbed } from "./explore-embed";

const plain: LinkEmbed = {
  title: "Plain",
  type: "link",
  url: "https://a.test",
};
const og: LinkEmbed = {
  imageUrl: "https://b.test/og.png",
  siteName: "Bee",
  title: "OG",
  type: "link",
  url: "https://b.test",
};
const youtube: LinkEmbed = {
  title: "Clip",
  type: "youtube",
  url: "https://youtu.be/dQw4w9WgXcQ",
  videoId: "dQw4w9WgXcQ",
};

describe("explore embed preview", () => {
  test("a later visual embed wins over an earlier plain link", () => {
    expect(selectPreviewEmbed([plain, og])).toBe(og);
    expect(selectPreviewEmbed([plain, youtube, og])).toBe(youtube);
  });

  test("plain links still render as the text row", () => {
    expect(selectPreviewEmbed([plain])).toBe(plain);
    expect(selectPreviewEmbed([])).toBeUndefined();
  });

  test("the chip names the site or says Link", () => {
    expect(embedSiteLabel(og)).toBe("Bee");
    expect(embedSiteLabel(plain)).toBe("Link");
  });
});
