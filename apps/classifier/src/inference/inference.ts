import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { InferenceSession, Tensor } from "onnxruntime-node";
import sharp from "sharp";

import { ClassifierError } from "../http/error";
import { model } from "./model";
import type { Classify } from "./model";

export async function preprocessImage(image: Uint8Array) {
  try {
    const pipeline = sharp(image, {
      failOn: "warning",
      limitInputPixels: 16_000_000,
    });
    const metadata = await pipeline.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new Error("Unsupported image");
    }
    const { data, info } = await pipeline
      .rotate()
      .removeAlpha()
      .toColourspace("srgb")
      .resize(model.inputSize, model.inputSize, {
        fit: "fill",
        kernel: sharp.kernel.linear,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) {
      throw new Error("Expected RGB image");
    }
    const area = model.inputSize * model.inputSize;
    const tensor = new Float32Array(area * 3);
    for (let pixel = 0; pixel < area; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        tensor[channel * area + pixel] = Number(data[pixel * 3 + channel]);
      }
    }
    return tensor;
  } catch {
    throw new ClassifierError("invalid_image", 422);
  }
}

export async function createClassifier(
  path: string,
  threads: number
): Promise<{ classify: Classify; close: () => Promise<void> }> {
  const bytes = await readFile(path);
  if (
    bytes.byteLength !== model.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== model.sha256
  ) {
    throw new Error("Classifier model checksum mismatch");
  }
  sharp.concurrency(1);
  sharp.cache({ files: 0, items: 32, memory: 32 });
  const session = await InferenceSession.create(bytes, {
    executionMode: "sequential",
    executionProviders: ["cpu"],
    extra: {
      session: {
        "inter_op.allow_spinning": "0",
        "intra_op.allow_spinning": "0",
      },
    },
    graphOptimizationLevel: "all",
    interOpNumThreads: 1,
    intraOpNumThreads: threads,
  });
  const [input] = session.inputNames;
  const [output] = session.outputNames;
  if (
    !input ||
    !output ||
    session.inputNames.length !== 1 ||
    session.outputNames.length !== 1
  ) {
    await session.release();
    throw new Error("Unexpected classifier graph interface");
  }
  const classify: Classify = async (image) => {
    const start = performance.now();
    const pixels = await preprocessImage(image);
    const prepared = performance.now();
    const tensor = new Tensor("float32", pixels, [
      1,
      3,
      model.inputSize,
      model.inputSize,
    ]);
    try {
      const results = await session.run({ [input]: tensor });
      try {
        const prediction = results[output];
        if (!prediction || prediction.data.length !== 3) {
          throw new Error("Unexpected classifier output");
        }
        const NSFL = Number(prediction.data[0]);
        const NSFW = Number(prediction.data[1]);
        const SFW = Number(prediction.data[2]);
        if (
          [NSFL, NSFW, SFW].some(
            (score) => !Number.isFinite(score) || score < 0 || score > 1
          ) ||
          Math.abs(NSFL + NSFW + SFW - 1) > 0.001
        ) {
          throw new Error("Invalid classifier probabilities");
        }
        const probabilities = { NSFL, NSFW, SFW };
        let label: (typeof model.labels)[number] = "NSFL";
        for (const candidate of model.labels) {
          if (probabilities[candidate] > probabilities[label]) {
            label = candidate;
          }
        }
        return {
          label,
          probabilities,
          timing: {
            decodeMs: prepared - start,
            inferenceMs: performance.now() - prepared,
          },
        };
      } finally {
        for (const result of Object.values(results)) {
          result.dispose();
        }
      }
    } finally {
      tensor.dispose();
    }
  };
  return { classify, close: () => session.release() };
}
