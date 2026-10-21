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
