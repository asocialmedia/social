import { expect, test } from "bun:test";

import { buildVideoJsonLd, videoWatchPath, videoWatchUrl } from "./video";

test("video watch metadata identifies the dedicated page and directly accessible media", () => {
  expect(videoWatchPath("post", "media")).toBe("/watch/post/media");
  const schema = buildVideoJsonLd({
    createdAt: new Date("2026-11-07T10:00:00.000Z"),
    description: "Watch a video",
    mediaId: "media",
    postId: "post",
    title: "A video",
  });
  expect(schema).toMatchObject({
    "@type": "VideoObject",
    contentUrl: "https://asocialmedia.cc/api/media/media",
    embedUrl: videoWatchUrl("post", "media"),
    thumbnailUrl: "https://asocialmedia.cc/api/media/media?thumb=1",
    uploadDate: "2026-11-07T10:00:00.000Z",
  });
});
