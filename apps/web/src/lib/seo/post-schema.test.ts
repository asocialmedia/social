import { expect, test } from "bun:test";

import { buildSocialPostJsonLd } from "./post-schema";

const post = {
  author: {
    name: "Alice",
    url: "https://asocialmedia.cc/users/alice",
    username: "alice",
  },
  commentCount: 3,
  content: "A real conversation about independent social networks.",
  createdAt: new Date("2026-10-25T00:00:00Z"),
  description: "An independent social network conversation",
  headline: "Independent social networks",
  media: [],
  url: "https://asocialmedia.cc/posts/12345678/independent-social-networks",
  viewCount: 10,
};

test("text-only social posts expose their actual body instead of a fabricated image", () => {
  const schema = buildSocialPostJsonLd(post);
  expect(schema.text).toBe(post.content);
  expect(schema.datePublished).toBe("2026-10-25T00:00:00.000Z");
  expect(schema.author.url).toBe(post.author.url);
  expect(schema.mainEntityOfPage["@id"]).toBe(post.url);
  expect(schema).not.toHaveProperty("image");
  expect(
    schema.interactionStatistic.map((stat) => stat.interactionType)
  ).not.toContain("https://schema.org/LikeAction");
});

test("media-only posts describe real crawlable attachments", () => {
  const schema = buildSocialPostJsonLd({
    ...post,
    content: "",
    media: [
      { id: "image-1", type: "image/png" },
      { id: "video-1", type: "VIDEO" },
    ],
  });
  expect(schema).not.toHaveProperty("text");
  expect(schema.image).toEqual(["https://asocialmedia.cc/api/media/image-1"]);
  expect(schema.video?.[0]).toMatchObject({
    "@type": "VideoObject",
    contentUrl: "https://asocialmedia.cc/api/media/video-1",
    thumbnailUrl: "https://asocialmedia.cc/api/media/video-1?thumb=1",
  });
});

test("interaction counts cannot be negative", () => {
  const schema = buildSocialPostJsonLd({
    ...post,
    commentCount: -1,
    viewCount: -3,
  });
  expect(
    schema.interactionStatistic.every((stat) => stat.userInteractionCount >= 0)
  ).toBe(true);
});
