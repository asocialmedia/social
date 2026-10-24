import { afterEach, beforeEach, expect, mock, test } from "bun:test";

import sharp from "sharp";

const values = new Map<string, string>();
let explicit = 0.01;
let sexualized = 0.01;
let failProvider = false;
let reads = 0;
const originalFetch = globalThis.fetch;
mock.module("@asm/db", () => ({
  EXTERNAL_MEDIA_SAFETY_VERSION: "v1",
  redis: {
    del: () => Promise.resolve(1),
    publish: () => Promise.resolve(0),
    set: (key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve("OK");
    },
  },
}));
mock.module("../analyze/clef", () => ({
  evaluateClef: () =>
    failProvider
      ? Promise.reject(new Error("provider offline"))
      : Promise.resolve({
          probabilities: { explicit, graphic_violence: 0.01, sexualized },
        }),
}));
const { externalSafetyImageUrl, processExternalMediaSafety } =
  await import("./external-media-safety");
const jpeg = await sharp({
  create: { background: "blue", channels: 3, height: 12, width: 12 },
})
  .jpeg()
  .toBuffer();
const input = {
  images: ["https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:artist/cid"],
  key: `external:media-safety:v1:${"a".repeat(64)}`,
  queuedAt: Date.now(),
  text: "Unlabelled artwork",
};
beforeEach(() => {
  values.clear();
  explicit = 0.01;
  sexualized = 0.01;
  failProvider = false;
  reads = 0;
  globalThis.fetch = Object.assign(
    mock(() => {
      reads += 1;
      return Promise.resolve(new Response(jpeg));
    }),
    { preconnect: originalFetch.preconnect }
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("unlabelled fetish artwork fails the visual gate even with a low nudity score", async () => {
  sexualized = 0.95;
  await processExternalMediaSafety(input);
  expect(values.get(input.key)).toBe("explicit");
});

test("only a completed safe image assessment publishes a reusable verdict", async () => {
  await processExternalMediaSafety(input);
  expect(values.get(input.key)).toBe("safe");
  failProvider = true;
  values.clear();
  await expect(processExternalMediaSafety(input)).rejects.toThrow(
    "provider offline"
  );
  expect(values.has(input.key)).toBe(false);
});

test("private hosts, credentials, non-image routes and stale jobs never trigger outbound reads", async () => {
  for (const url of [
    "http://127.0.0.1/private",
    "https://cdn.bsky.app.evil.test/img/feed_thumbnail/plain/x",
    "https://token@cdn.bsky.app/img/feed_thumbnail/plain/x",
    "https://cdn.bsky.app/private",
    "https://video.bsky.app/watch/x/y/playlist.m3u8",
  ]) {
    expect(() => externalSafetyImageUrl(url)).toThrow();
  }
  expect(
    externalSafetyImageUrl(
      "https://video.bsky.app/watch/did%3Aplc%3Aartist/cid/thumbnail.jpg"
    ).hostname
  ).toBe("video.bsky.app");
  await processExternalMediaSafety({
    ...input,
    queuedAt: Date.now() - 900_001,
  });
  expect(reads).toBe(0);
});

test("Bluesky video thumbnails follow only validated image redirects and then receive a real assessment", async () => {
  const urls: string[] = [];
  const destination =
    "https://video.cdn.bsky.app/hls/did:plc:artist/cid/thumbnail.jpg";
  globalThis.fetch = Object.assign(
    mock((url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      expect(init?.redirect).toBe("manual");
      return Promise.resolve(
        urls.length === 1
          ? new Response(null, {
              headers: { location: destination },
              status: 302,
            })
          : new Response(jpeg)
      );
    }),
    { preconnect: originalFetch.preconnect }
  );
  await processExternalMediaSafety({
    ...input,
    images: [
      "https://video.bsky.app/watch/did%3Aplc%3Aartist/cid/thumbnail.jpg",
    ],
  });
  expect(urls).toHaveLength(2);
  expect(urls[1]).toBe(destination);
  expect(values.get(input.key)).toBe("safe");
});

test.each([
  "http://127.0.0.1/thumbnail.jpg",
  "https://video.cdn.bsky.app.evil.test/hls/a/b/thumbnail.jpg",
  "https://video.cdn.bsky.app/hls/a/b/playlist.m3u8",
])(
  "unsafe redirect destinations never receive a request or publish a safe verdict: %s",
  async (location) => {
    globalThis.fetch = Object.assign(
      mock(() => {
        reads += 1;
        return Promise.resolve(
          new Response(null, { headers: { location }, status: 302 })
        );
      }),
      { preconnect: originalFetch.preconnect }
    );
    await expect(processExternalMediaSafety(input)).rejects.toThrow(
      "Unsupported"
    );
    expect(reads).toBe(1);
    expect(values.has(input.key)).toBe(false);
  }
);

test("a redirect loop stops after a bounded number of validated hops", async () => {
  globalThis.fetch = Object.assign(
    mock(() => {
      reads += 1;
      return Promise.resolve(
        new Response(null, {
          headers: { location: input.images[0] },
          status: 302,
        })
      );
    }),
    { preconnect: originalFetch.preconnect }
  );
  await expect(processExternalMediaSafety(input)).rejects.toThrow(
    "unavailable"
  );
  expect(reads).toBe(4);
  expect(values.has(input.key)).toBe(false);
});
