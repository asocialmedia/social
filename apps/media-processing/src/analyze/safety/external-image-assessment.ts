import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { redis } from "@asm/db";

import { workerEnv } from "../../env";
import { evaluateClef } from "../classification/clef";
import {
  evaluateSwiftformer,
  parseSwiftformerResult,
} from "../classification/swiftformer";

export type ExternalVisualVerdict = "safe" | "explicit" | "uncertain";

export function swiftformerVisualVerdict(
  result: ReturnType<typeof parseSwiftformerResult>
): ExternalVisualVerdict {
  const scores = result.probabilities;
  if (result.label !== "SFW" || scores.NSFL >= 0.1) {
    return "explicit";
  }
  if (scores.SFW >= 0.9 && scores.NSFW <= 0.06 && scores.NSFL <= 0.04) {
    return "safe";
  }
  return "uncertain";
}

async function cachedSwiftformer(path: string) {
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  const key = `external:swiftformer:v1:54f4560bd9c5ee92d45dc30418a8f8680e80de6d:${digest}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached) {
    try {
      return parseSwiftformerResult(JSON.parse(cached));
    } catch {
      // A corrupt or incompatible cached score must be reassessed.
    }
  }
  const result = await evaluateSwiftformer(path);
  await redis
    .set(key, JSON.stringify(result), "EX", 7 * 24 * 60 * 60)
    .catch(() => null);
  return result;
}

export async function assessExternalImages(
  paths: string[],
  text: string
): Promise<"safe" | "explicit"> {
  if (!paths.length) {
    throw new Error("External assessment requires an image");
  }
  if (workerEnv.CLASSIFIER_URL && workerEnv.CLASSIFIER_API_TOKEN) {
    // A job contains at most four images; the worker admits two jobs concurrently.
    const scores = await Promise.all(paths.map(cachedSwiftformer));
    const verdicts = scores.map(swiftformerVisualVerdict);
    if (verdicts.includes("explicit")) {
      return "explicit";
    }
    if (verdicts.every((verdict) => verdict === "safe")) {
      return "safe";
    }
  }
  // Ambiguous images retain contextual assessment within the shared free allowance.
  const decision = await evaluateClef({ imagePaths: paths, text });
  return (decision.probabilities.explicit ?? 1) >= 0.5 ||
    (decision.probabilities.sexualized ?? 1) >= 0.5 ||
    (decision.probabilities.graphic_violence ?? 1) >= 0.5
    ? "explicit"
    : "safe";
}
