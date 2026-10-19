import type { ExternalPost } from "@asm/protocols/contracts";

export function inventoryPost(
  index: number,
  topic = "TypeScript",
  likes = 20
): ExternalPost {
  const did = `did:plc:inventory${index}`;
  return {
    author: {
      displayName: "Inventory fixture",
      handle: "fixture.bsky.social",
      id: did,
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: `https://bsky.app/profile/${did}`,
    },
    createdAt: new Date(Date.now() - index * 1000).toISOString(),
    id: `at://${did}/app.bsky.feed.post/example`,
    indexedAt: new Date().toISOString(),
    labels: [],
    languages: ["en"],
    media:
      index % 2
        ? []
        : [
            {
              alt: `${topic} demonstration`,
              type: "video",
              url: "https://video.bsky.app/fixture.m3u8",
            },
          ],
    revision: "cid",
    segments: [{ text: `${topic} demonstration ${index}` }],
    source: "bluesky",
    tags: [topic],
    text: `${topic} demonstration ${index}`,
    upstreamCounts: { likes, quotes: 0, replies: 0, reposts: 0 },
    url: `https://bsky.app/profile/${did}/post/example`,
  };
}
