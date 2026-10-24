import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EXTERNAL_MEDIA_SAFETY_VERSION,
  redis,
  releaseExternalMediaSafetyClaim,
} from "@asm/db";
import { FEED_EVENTS_CHANNEL, retryAfterMs } from "@asm/protocols/discovery";
import sharp from "sharp";
import { z } from "zod";

import { ClefDeferredError } from "../analyze/clef";
import { assessExternalImages } from "../analyze/external-image-assessment";
import { workerEnv } from "../env";

export class ExternalMediaDownloadDeferredError extends Error {
  readonly retryAt: number;
  readonly status: number | undefined;
  constructor(message: string, retryAt: number, status?: number) {
    super(message);
    this.name = "ExternalMediaDownloadDeferredError";
    this.retryAt = retryAt;
    this.status = status;
  }
}

export const externalSafetyJobSchema = z.object({
  images: z.array(z.string().max(4096)).min(1).max(20),
  key: z.string().regex(/^external:media-safety:v\d+:[a-f0-9]{64}$/),
  owner: z.uuid().optional(),
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
      /^\/watch\/[^/]+\/[^/]+\/thumbnail\.jpg$/u.test(url.pathname)) ||
    (url.hostname === "video.cdn.bsky.app" &&
      /^\/hls\/[^/]+\/[^/]+\/thumbnail\.jpg$/u.test(url.pathname));
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
  const signal = AbortSignal.timeout(8000);
  let url = externalSafetyImageUrl(raw);
  let response = await fetch(url, { redirect: "manual", signal });
  for (
    let hop = 0;
    hop < 3 && response.status >= 300 && response.status < 400;
    hop += 1
  ) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) {
      throw new Error("External safety image redirect has no destination");
    }
    url = externalSafetyImageUrl(new URL(location, url).href);
    // oxlint-disable-next-line no-await-in-loop -- validate every redirect before connecting to its destination.
    response = await fetch(url, { redirect: "manual", signal });
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) {
      throw new ExternalMediaDownloadDeferredError(
        `External safety image HTTP ${response.status}`,
        Date.now() + 300_000,
        response.status
      );
    }
    if (
      response.status === 403 ||
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      const delay =
        retryAfterMs(response.headers.get("retry-after")) ??
        (response.status === 403 ? 300_000 : 30_000);
      throw new ExternalMediaDownloadDeferredError(
        `External safety image HTTP ${response.status}`,
        Date.now() + Math.min(300_000, Math.max(1000, delay))
      );
    }
    throw new Error(`External safety image HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024) {
    await response.body?.cancel();
    throw new Error("External safety image exceeds byte limit");
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
    await releaseExternalMediaSafetyClaim(input);
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
      const verdict = await assessExternalImages(paths, input.text);
      if (verdict === "explicit") {
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
    await releaseExternalMediaSafetyClaim(input);
    await redis.publish(
      FEED_EVENTS_CHANNEL,
      JSON.stringify({ source: "bluesky" })
    );
  } catch (error) {
    if (error instanceof ClefDeferredError && workerEnv.CLASSIFIER_URL) {
      // Unknown visual content remains withheld without occupying the cheap-classification queue until quota reset.
      await redis.set(input.key, "uncertain", "EX", 300);
      await releaseExternalMediaSafetyClaim(input);
      return;
    }
    if (
      error instanceof ExternalMediaDownloadDeferredError &&
      [404, 410].includes(error.status ?? 0)
    ) {
      await redis.set(input.key, "unavailable", "EX", 300);
      await releaseExternalMediaSafetyClaim(input);
      return;
    }
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    ) {
      throw new ExternalMediaDownloadDeferredError(
        "External safety image download timed out",
        Date.now() + 30_000
      );
    }
    throw error;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
