import { afterEach, expect, mock, test } from "bun:test";

import sharp from "sharp";

const values = new Map<string, string>();
const set = mock((key: string, value: string, ..._args: unknown[]) => {
  values.set(key, value);
  return Promise.resolve("OK");
});
mock.module("@asm/db", () => ({
  EXTERNAL_MEDIA_SAFETY_VERSION: "v1",
  redis: { publish: () => Promise.resolve(0), set },
  releaseExternalMediaSafetyClaim: () => Promise.resolve(),
}));
mock.module("../../env", () => ({
  workerEnv: {
    CLASSIFIER_API_TOKEN: "configured",
    CLASSIFIER_URL: "https://classifier.test",
    EXTERNAL_CLEF_ENABLED: false,
  },
}));
let groups = 0;
mock.module("../../analyze/safety/external-image-assessment", () => ({
  assessExternalImages: () => {
    groups += 1;
    return Promise.resolve(groups === 1 ? "uncertain" : "explicit");
  },
}));
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  sharp.cache(false);
});

test("a later explicit group overrides an earlier uncertain group and receives the long cache TTL", async () => {
  const jpeg = await sharp({
    create: { background: "red", channels: 3, height: 8, width: 8 },
  })
    .jpeg()
    .toBuffer();
  globalThis.fetch = Object.assign(() => Promise.resolve(new Response(jpeg)), {
    preconnect: originalFetch.preconnect,
  });
  const { processExternalMediaSafety } =
    await import("./external-media-safety");
  const key = `external:media-safety:v1:${"b".repeat(64)}`;
  await processExternalMediaSafety({
    images: Array.from(
      { length: 5 },
      (_, index) =>
        `https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:author/image-${index}`
    ),
    key,
    queuedAt: Date.now(),
    text: "post",
  });
  expect(groups).toBe(2);
  expect(values.get(key)).toBe("explicit");
  expect(set).toHaveBeenCalledWith(key, "explicit", "EX", 7 * 24 * 60 * 60);
});
