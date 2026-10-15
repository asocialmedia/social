// Cloud Vision scene-text extraction runs on the existing raster derivative.
// Successful empty results are checkpointed; provider failures remain retryable.
import { z } from "zod";

import { workerEnv } from "../env";
import { reserveProviderRequest } from "./provider-budget";

export const OCR_MODEL_VERSION = "google-cloud-vision-text-detection-v1";
const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
// Leave room for base64 expansion and JSON under Vision's 10 MB request limit.
const MAX_INLINE_IMAGE_BYTES = 7_000_000;
const visionResponseSchema = z.object({
  responses: z
    .array(
      z.object({
        error: z.object({ code: z.number().int() }).optional(),
        fullTextAnnotation: z.object({ text: z.string() }).optional(),
        textAnnotations: z
          .array(z.object({ description: z.string() }))
          .optional(),
      })
    )
    .length(1),
});

export interface OcrResult {
  modelVersion: string;
  // Empty means the request succeeded without readable text.
  text: string;
}

export class OcrDeferredError extends Error {
  readonly retryAt: number;

  constructor(message: string, retryAt = Date.now() + 60_000) {
    super(message);
    this.name = "OcrDeferredError";
    this.retryAt = retryAt;
  }
}

function providerRetryAt(response: Response): number {
  const value = response.headers.get("retry-after");
  const seconds = value === null ? Number.NaN : Number(value);
  const timestamp = Number.isFinite(seconds)
    ? Date.now() + seconds * 1000
    : Date.parse(value ?? "");
  return Number.isFinite(timestamp)
    ? Math.max(Date.now() + 1000, timestamp)
    : Date.now() + 60_000;
}

export async function extractImageText(
  imagePath: string
): Promise<OcrResult | null> {
  if (!workerEnv.OCR_ENABLED) {
    return null;
  }
  const apiKey = workerEnv.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    throw new OcrDeferredError(
      "Cloud Vision OCR needs GOOGLE_CLOUD_VISION_API_KEY",
      Date.now() + 15 * 60_000
    );
  }
  const file = Bun.file(imagePath);
  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("Cloud Vision OCR raster exceeds the 7 MB inline limit");
  }
  const content = Buffer.from(await file.arrayBuffer()).toString("base64");
  await reserveProviderRequest("vision");
  let response: Response;
  try {
    response = await fetch(VISION_ENDPOINT, {
      body: JSON.stringify({
        requests: [
          { features: [{ type: "TEXT_DETECTION" }], image: { content } },
        ],
      }),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
      method: "POST",
      signal: AbortSignal.timeout(workerEnv.OCR_TIMEOUT_MS),
    });
  } catch {
    // Avoid logging request headers, uploaded content, or provider error bodies.
    throw new OcrDeferredError("Cloud Vision OCR request timed out or failed");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new OcrDeferredError(
        `Cloud Vision OCR authentication/configuration failed (HTTP ${response.status})`,
        Date.now() + 15 * 60_000
      );
    }
    if (
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      throw new OcrDeferredError(
        `Cloud Vision OCR HTTP ${response.status}`,
        providerRetryAt(response)
      );
    }
    throw new Error(`Cloud Vision OCR HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OcrDeferredError("Cloud Vision OCR returned invalid JSON");
  }
  const parsed = visionResponseSchema.safeParse(payload);
  const annotation = parsed.success ? parsed.data.responses[0] : undefined;
  if (!annotation) {
    throw new OcrDeferredError("Cloud Vision OCR returned an invalid response");
  }
  // Vision may return a per-image failure even when HTTP status is 200.
  const code = annotation.error?.code;
  if (code) {
    if ([4, 8, 10, 13, 14].includes(code)) {
      throw new OcrDeferredError(
        `Cloud Vision OCR image error ${code}`,
        providerRetryAt(response)
      );
    }
    if ([7, 16].includes(code)) {
      throw new OcrDeferredError(
        `Cloud Vision OCR image authorization error ${code}`,
        Date.now() + 15 * 60_000
      );
    }
    throw new Error(`Cloud Vision OCR image error ${code}`);
  }
  return {
    modelVersion: OCR_MODEL_VERSION,
    // textAnnotations[0] contains the entire text; later entries repeat words.
    text:
      annotation.fullTextAnnotation?.text ??
      annotation.textAnnotations?.[0]?.description ??
      "",
  };
}

export function isOcrConfigured(): boolean {
  return (
    workerEnv.OCR_ENABLED && Boolean(workerEnv.GOOGLE_CLOUD_VISION_API_KEY)
  );
}
