import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { redis } from "@asm/db";

import { workerEnv } from "../../env";
import { recordMediaMetric } from "../../metrics";
import { evaluateClef } from "../classification/clef";
import { ClassifierDeferredError } from "../classification/deferred";
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

const pendingAssessments = new Map<
  string,
  Promise<ReturnType<typeof parseSwiftformerResult>>
>();

async function cachedSwiftformer(path: string) {
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  const key = `external:swiftformer:v1:54f4560bd9c5ee92d45dc30418a8f8680e80de6d:${digest}`;
  const pending = pendingAssessments.get(key);
  if (pending) {
    return pending;
  }
  const assessment = readOrEvaluateSwiftformer(key, path);
  pendingAssessments.set(key, assessment);
  try {
    return await assessment;
  } finally {
    pendingAssessments.delete(key);
  }
}

async function readOrEvaluateSwiftformer(key: string, path: string) {
  const cached = await redis.get(key).catch(() => {
    throw new ClassifierDeferredError();
  });
  if (cached) {
    try {
      const result = parseSwiftformerResult(JSON.parse(cached));
      await recordMediaMetric("classifier.cache-hit", 0);
      return result;
    } catch {
      // A corrupt or incompatible cached score must be reassessed.
    }
  }
  const lockKey = `${key}:lock`;
  const owner = crypto.randomUUID();
  const acquired = await redis
    .set(lockKey, owner, "PX", 30_000, "NX")
    .catch(() => null);
  if (acquired !== "OK") {
    throw new ClassifierDeferredError();
  }
  try {
    // Recheck after claiming: another worker may have filled the cache between GET and SET.
    const completed = await redis.get(key);
    if (completed) {
      try {
        return parseSwiftformerResult(JSON.parse(completed));
      } catch {
        // Replace a corrupt cached score while holding the claim.
      }
    }
    await recordMediaMetric("classifier.cache-miss", 0);
    const started = performance.now();
    const result = await evaluateSwiftformer(path);
    await recordMediaMetric("classifier.request", performance.now() - started);
    await redis.set(key, JSON.stringify(result), "EX", 7 * 24 * 60 * 60);
    return result;
  } finally {
    try {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
        1,
        lockKey,
        owner
      );
    } catch {
      // Expiry releases the claim if Redis is temporarily unavailable.
    }
  }
}

export async function assessExternalImages(
  paths: string[],
  text: string
): Promise<ExternalVisualVerdict> {
  if (!paths.length) {
    throw new Error("External assessment requires an image");
  }
  if (workerEnv.CLASSIFIER_URL && workerEnv.CLASSIFIER_API_TOKEN) {
    // Each group contains at most four images; queue admission is bounded across replicas.
    const scores = await Promise.all(paths.map(cachedSwiftformer));
    const verdicts = scores.map(swiftformerVisualVerdict);
    if (verdicts.includes("explicit")) {
      return "explicit";
    }
    if (verdicts.every((verdict) => verdict === "safe")) {
      return "safe";
    }
  }
  if (!workerEnv.EXTERNAL_CLEF_ENABLED) {
    return "uncertain";
  }
  // Optional contextual assessment asks only safety questions, rather than every topic label.
  const decision = await evaluateClef({
    imagePaths: paths,
    scope: "safety",
    source: "external",
    text,
  });
  return (decision.probabilities.explicit ?? 1) >= 0.5 ||
    (decision.probabilities.sexualized ?? 1) >= 0.5 ||
    (decision.probabilities.graphic_violence ?? 1) >= 0.5
    ? "explicit"
    : "safe";
}
