import { afterEach, expect, test } from "bun:test";

import sharp from "sharp";

import { ogMediaDataUrl } from "./og-media";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const respond = (response: Response) => {
  globalThis.fetch = Object.assign(() => Promise.resolve(response), {
    preconnect: originalFetch.preconnect,
  });
};

test("social cards convert WebP bytes into a Satori-supported JPEG", async () => {
  const source = await sharp({
    create: { background: "green", channels: 3, height: 20, width: 30 },
  })
    .webp()
    .toBuffer();
  respond(new Response(source, { headers: { "content-type": "image/webp" } }));
  const result = await ogMediaDataUrl(
    "https://asocialmedia.cc/api/media/image"
  );
  expect(result).toStartWith("data:image/jpeg;base64,");
  const bytes = Buffer.from(result?.split(",")[1] ?? "", "base64");
  const metadata = await sharp(bytes).metadata();
  expect(metadata.format).toBe("jpeg");
});

test("missing, private, malformed and oversized media produce a usable text-only card", async () => {
  for (const response of [
    new Response("missing", { status: 404 }),
    new Response("private", { status: 401 }),
    new Response("not a JPEG", { headers: { "content-type": "image/jpeg" } }),
    new Response("oversized", {
      headers: {
        "content-length": String(6 * 1024 * 1024),
        "content-type": "image/jpeg",
      },
    }),
  ]) {
    respond(response);
    // oxlint-disable-next-line no-await-in-loop -- each response fixture replaces the fetch boundary for the next assertion.
    const result = await ogMediaDataUrl(
      "https://asocialmedia.cc/api/media/missing"
    );
    expect(result).toBeNull();
  }
  expect(await ogMediaDataUrl(null)).toBeNull();
});
