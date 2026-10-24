import { beforeEach, expect, mock, test } from "bun:test";

const warmed: string[][] = [];
let snapshots: (string | null)[] = [];
let ids: string[] = [];
const scan = mock((..._arguments: unknown[]) => Promise.resolve(ids));
const read = mock(() => Promise.resolve(snapshots));
mock.module("@asm/db", () => ({
  filterExternalMediaSafety: (posts: { id: string }[]) => {
    warmed.push(posts.map((post) => post.id));
    return Promise.resolve(posts);
  },
  redis: { hmget: read, zrevrangebyscore: scan },
}));
const { warmExternalMediaSafety } =
  await import("./warm-external-media-safety");
beforeEach(() => {
  warmed.length = 0;
  snapshots = [];
  ids = [];
  scan.mockClear();
  read.mockClear();
});
function createSnapshot(id: string, video: boolean) {
  return JSON.stringify({
    author: {
      displayName: "Author",
      handle: "author.bsky.social",
      id: "did:plc:author",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/did:plc:author",
    },
    createdAt: new Date().toISOString(),
    id,
    indexedAt: new Date().toISOString(),
    labels: [],
    languages: ["en"],
    media: video
      ? [
          {
            alt: "Video",
            type: "video",
            url: "https://video.bsky.app/video.m3u8",
          },
        ]
      : [],
    revision: "cid",
    segments: [{ text: "Example" }],
    source: "bluesky",
    text: "Example",
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    url: "https://bsky.app/profile/did:plc:author/post/example",
  });
}
test("video assessments start ahead of text candidates and malformed snapshots never enter the queue", async () => {
  const text = "at://did:plc:author/app.bsky.feed.post/text";
  const video = "at://did:plc:author/app.bsky.feed.post/video";
  ids = [text, "invalid", video];
  snapshots = [
    createSnapshot(text, false),
    "invalid json",
    createSnapshot(video, true),
  ];
  await warmExternalMediaSafety();
  expect(warmed).toEqual([[video, text]]);
  expect(scan.mock.calls[0]).toEqual(
    expect.arrayContaining(["LIMIT", 0, 2000])
  );
});
test("older retained videos remain eligible for proactive assessment", async () => {
  const startedAt = Date.now();
  await warmExternalMediaSafety();
  const minimumTime = Number(scan.mock.calls[0]?.[2]);
  expect(minimumTime).toBeGreaterThanOrEqual(startedAt - 10 * 60_000);
  expect(minimumTime).toBeLessThan(Date.now() - 9 * 60_000);
});
test("an empty verified inventory never opens a safety queue", async () => {
  await warmExternalMediaSafety();
  expect(read).not.toHaveBeenCalled();
  expect(warmed).toEqual([]);
});
