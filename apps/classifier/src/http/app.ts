import { createHash, timingSafeEqual } from "node:crypto";

import { maxImageBytes, model } from "../inference/model";
import type { Classify } from "../inference/model";
import { InferenceQueue } from "../inference/queue";
import type { classifierConfig } from "../runtime/config";
import { readImageBody } from "./body";
import { ClassifierError } from "./error";

const json = (value: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(value, {
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
    status,
  });

export function createClassifierApp(
  config: ReturnType<typeof classifierConfig>,
  classify: Classify
) {
  const queue = new InferenceQueue(config.queueLimit);
  const expected = createHash("sha256")
    .update(`Bearer ${config.token}`)
    .digest();
  let completed = 0;
  let failed = 0;
  return async (request: Request) => {
    const path = new URL(request.url).pathname;
    if ((path === "/health" || path === "/ready") && request.method === "GET") {
      return json({ status: "ready" });
    }
    const supplied = createHash("sha256")
      .update(request.headers.get("authorization") ?? "")
      .digest();
    if (!timingSafeEqual(expected, supplied)) {
      return json({ error: "unauthorized" }, 401);
    }
    if (path === "/v1/model" && request.method === "GET") {
      return json({
        ...model,
        completed,
        failed,
        maxImageBytes,
        queue: queue.status(),
        threads: config.threads,
      });
    }
    if (path !== "/v1/classify") {
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    }
    if (
      !/^image\/(?:jpeg|png|webp)(?:;|$)/u.test(
        request.headers.get("content-type") ?? ""
      )
    ) {
      return json({ error: "unsupported_media_type" }, 415);
    }
    if (Number(request.headers.get("content-length")) > maxImageBytes) {
      return json({ error: "image_too_large" }, 413);
    }
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(config.requestTimeoutMs),
    ]);
    const start = performance.now();
    try {
      return await queue.run(async () => {
        const queuedMs = performance.now() - start;
        const image = await readImageBody(request, signal);
        signal.throwIfAborted();
        if (!image.byteLength || image.byteLength > maxImageBytes) {
          return json({ error: "invalid_image_size" }, 413);
        }
        const result = await classify(image);
        signal.throwIfAborted();
        completed += 1;
        return json({
          ...result,
          model: {
            id: model.id,
            preprocessing: model.preprocessing,
            revision: model.revision,
            sha256: model.sha256,
          },
          timing: {
            ...result.timing,
            queuedMs,
            totalMs: performance.now() - start,
          },
        });
      }, signal);
    } catch (error) {
      failed += 1;
      if (error instanceof ClassifierError) {
        return json(
          { error: error.code },
          error.status,
          error.status === 503 ? { "retry-after": "1" } : undefined
        );
      }
      if (signal.aborted) {
        return json({ error: "request_cancelled" }, 408);
      }
      return json({ error: "inference_failed" }, 500);
    }
  };
}
