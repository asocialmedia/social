import sharp from "sharp";
import { z } from "zod";

import { workerEnv } from "../../env";

const probability = z.number().finite().min(0).max(1);
const responseSchema = z.object({
  label: z.enum(["SFW", "NSFW", "NSFL"]),
  model: z.object({
    revision: z.literal("54f4560bd9c5ee92d45dc30418a8f8680e80de6d"),
    sha256: z.literal(
      "8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689"
    ),
  }),
  probabilities: z.object({
    NSFL: probability,
    NSFW: probability,
    SFW: probability,
  }),
  timing: z.object({
    decodeMs: z.number().finite().nonnegative(),
    inferenceMs: z.number().finite().nonnegative(),
    queuedMs: z.number().finite().nonnegative(),
    totalMs: z.number().finite().nonnegative(),
  }),
});

export function parseSwiftformerResult(value: unknown) {
  const result = responseSchema.parse(value);
  const sum = Object.values(result.probabilities).reduce(
    (total, score) => total + score,
    0
  );
  if (Math.abs(sum - 1) > 0.01) {
    throw new Error("SwiftFormer returned invalid probabilities");
  }
  if (
    Object.values(result.probabilities).some(
      (score) => score > result.probabilities[result.label]
    )
  ) {
    throw new Error("SwiftFormer label does not match its probabilities");
  }
  return result;
}

// Feed policy interprets these verified model scores separately from inference transport.
export async function evaluateSwiftformer(imagePath: string) {
  const baseUrl = workerEnv.CLASSIFIER_URL;
  const token = workerEnv.CLASSIFIER_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("SwiftFormer endpoint and credentials are not configured");
  }
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "asmdev-classifier"].includes(url.hostname)
    )
  ) {
    throw new Error("SwiftFormer requires HTTPS outside local development");
  }
  const image = await sharp(imagePath, { limitInputPixels: 16_000_000 })
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "white" })
    .jpeg({ quality: 80 })
    .toBuffer();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/classify`, {
    body: image,
    headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg" },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `SwiftFormer HTTP ${response.status}; analysis remains pending`
    );
  }
  return parseSwiftformerResult(await response.json());
}
