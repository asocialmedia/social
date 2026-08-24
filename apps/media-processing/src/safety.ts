// NSFW safety classification. Runs an ONNX image-classifier on the poster or
// a representative derivative via onnxruntime-node, loaded lazily so builds
// and dev environments without MEDIA_NSFW_MODEL_PATH skip cleanly.
//
// Model contract: 224x224 RGB input, float32 NCHW, softmax over
// [drawings, hentai, neutral, porn, sexy] (Falconsai/nsfw_image_detection
// ONNX export layout). A different label order only needs LABELS edited.

import type { SafetyVerdict } from "@asm/media";

const LABELS = ["drawings", "hentai", "neutral", "porn", "sexy"] as const;
// porn+hentai above this marks media explicit; sexy alone stays advisory.
const EXPLICIT_THRESHOLD = 0.6;
const MODEL_INPUT = 224;

export const NSFW_MODEL_VERSION = "falconsai-nsfw-onnx-v1";

interface InferenceSessionLike {
  inputNames: string[];
  run: (feed: Record<string, Float32Array>) => Promise<Record<string, unknown>>;
}

let session: InferenceSessionLike | null = null;
let sessionFailed = false;

async function getSession(): Promise<InferenceSessionLike | null> {
  if (session || sessionFailed) {
    return session;
  }
  const modelPath = process.env.MEDIA_NSFW_MODEL_PATH;
  if (!modelPath) {
    sessionFailed = true;
    return null;
  }
  try {
    const ort = (await import("onnxruntime-node")) as unknown as {
      InferenceSession: new (path: string) => Promise<InferenceSessionLike>;
    };
    session = await new ort.InferenceSession(modelPath);
    return session;
  } catch (error) {
    console.error(`NSFW model failed to load from ${modelPath}:`, error);
    sessionFailed = true;
    return null;
  }
}

// Decodes any browser-supported source image with Bun.Image and produces the
// normalized NCHW tensor bytes.
async function preprocess(
  imagePath: string
): Promise<{ data: Float32Array } | null> {
  const decoded = await Bun.file(imagePath)
    .image()
    .resize(MODEL_INPUT, MODEL_INPUT, { fit: "fill" })
    .png()
    .buffer();
  // PNG RGBA output: strip alpha, scale to [0,1], normalize ImageNet-style.
  const pixels = new Uint8Array(decoded);
  const channels = 3;
  const planeSize = MODEL_INPUT * MODEL_INPUT;
  const data = new Float32Array(channels * planeSize);
  for (let i = 0; i < planeSize; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      data[c * planeSize + i] = pixels[i * 4 + c] / 255;
    }
  }
  return { data };
}

export async function classifyImageSafety(
  imagePath: string
): Promise<SafetyVerdict | null> {
  const inference = await getSession();
  if (!inference) {
    return null;
  }
  const input = await preprocess(imagePath);
  if (!input) {
    return null;
  }
  const [inputName = "input"] = inference.inputNames;
  const output = await inference.run({ [inputName]: input.data });
  const [firstKey] = Object.keys(output);
  if (!firstKey) {
    return null;
  }
  const logits = output[firstKey] as unknown as { data?: number[] };
  const scores = logits.data ?? [];
  if (scores.length < LABELS.length) {
    return null;
  }

  const byLabel: Record<string, number> = {};
  for (const [index, label] of LABELS.entries()) {
    byLabel[label] = scores[index] ?? 0;
  }
  const nsfwScore =
    (byLabel.porn ?? 0) + (byLabel.hentai ?? 0) + (byLabel.sexy ?? 0) * 0.25;

  let dominant: (typeof LABELS)[number] = "neutral";
  let dominantScore = -1;
  for (const label of LABELS) {
    const score = byLabel[label] ?? 0;
    if (score > dominantScore) {
      dominant = label;
      dominantScore = score;
    }
  }

  return {
    evaluatedAt: new Date().toISOString(),
    explicit:
      (byLabel.porn ?? 0) > EXPLICIT_THRESHOLD ||
      (byLabel.hentai ?? 0) > EXPLICIT_THRESHOLD,
    modelVersion: NSFW_MODEL_VERSION,
    nsfwLabel: (dominant as SafetyVerdict["nsfwLabel"]) ?? "unknown",
    nsfwScore: Number(nsfwScore.toFixed(4)),
  };
}

export function isNsfwConfigured(): boolean {
  return Boolean(process.env.MEDIA_NSFW_MODEL_PATH);
}
