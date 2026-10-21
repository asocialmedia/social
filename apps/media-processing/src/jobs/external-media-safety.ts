import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EXTERNAL_MEDIA_SAFETY_VERSION, redis } from "@asm/db";
import { FEED_EVENTS_CHANNEL } from "@asm/protocols/discovery";
import sharp from "sharp";
import { z } from "zod";

import { evaluateClef } from "../analyze/clef";

export const externalSafetyJobSchema = z.object({
  images: z.array(z.string().max(4096)).min(1).max(20),
  key: z.string().regex(/^external:media-safety:v\d+:[a-f0-9]{64}$/),
  queuedAt: z.number().finite(),
  text: z.string().max(8000),
});

export function externalSafetyImageUrl(raw: string): URL {
  const url = new URL(raw);
  const supported =
    (url.hostname === "cdn.bsky.app" &&
      /^\/img\/(?:feed_thumbnail|feed_fullsize|video_thumbnail)\/plain\//u.test(
        url.pathname
      )) ||
    (url.hostname === "video.bsky.app" &&
      /^\/watch\/[^/]+\/[^/]+\/thumbnail.jpg$/u.test(url.pathname));
  if (
    url.protocol !== "https:" ||
    !supported ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Unsupported external safety image source");
  }
  return url;
}

async function downloadImage(raw: string, output: string) {
  const response = await fetch(externalSafetyImageUrl(raw), {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 2 * 1024 * 1024
  ) {
    await response.body?.cancel();
    throw new Error("External safety image unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("External safety image has no body");
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- enforce the byte ceiling before reading another chunk.
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        throw new Error("External safety image exceeds byte limit");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => null);
    reader.releaseLock();
  }
  await sharp(Buffer.concat(chunks), { limitInputPixels: 16_000_000 })
    .rotate()
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .jpeg()
    .toFile(output);
}

export async function processExternalMediaSafety(raw: unknown) {
  const input = externalSafetyJobSchema.parse(raw);
  if (
    Date.now() - input.queuedAt > 15 * 60_000 ||
    !input.key.startsWith(
      `external:media-safety:${EXTERNAL_MEDIA_SAFETY_VERSION}:`
    )
  ) {
    await redis.del(`${input.key}:queued`);
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "asm-external-safety-"));
  try {
    let explicit = false;
    for (let offset = 0; offset < input.images.length; offset += 4) {
      const paths = await Promise.all(
        input.images.slice(offset, offset + 4).map(async (url, index) => {
          const output = path.join(directory, `${offset + index}.jpg`);
          await downloadImage(url, output);
          return output;
        })
      );
      // oxlint-disable-next-line no-await-in-loop -- every image group must pass before publishing a safe verdict.
      const decision = await evaluateClef({
        imagePaths: paths,
        text: input.text,
      });
      if (
        (decision.probabilities.explicit ?? 1) >= 0.5 ||
        (decision.probabilities.sexualized ?? 1) >= 0.5 ||
        (decision.probabilities.graphic_violence ?? 1) >= 0.5
      ) {
        explicit = true;
        break;
      }
    }
    await redis.set(
      input.key,
      explicit ? "explicit" : "safe",
      "EX",
      7 * 24 * 60 * 60
    );
    await redis.del(`${input.key}:queued`);
    await redis.publish(
      FEED_EVENTS_CHANNEL,
      JSON.stringify({ source: "bluesky" })
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
