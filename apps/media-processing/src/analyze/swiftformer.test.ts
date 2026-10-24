import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

mock.module("../env", () => ({
  workerEnv: {
    CLASSIFIER_API_TOKEN: "asm-local-classifier-development-token-3014",
    CLASSIFIER_URL: "http://127.0.0.1:3014",
  },
}));
const { evaluateSwiftformer } = await import("./swiftformer");
const originalFetch = globalThis.fetch;
let directory = "";
let imagePath = "";
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "asm-classifier-client-"));
  imagePath = path.join(directory, "test.png");
  await sharp({
    create: { background: "blue", channels: 3, height: 12, width: 12 },
  })
    .png()
    .toFile(imagePath);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
afterAll(async () => {
  await rm(directory, { force: true, recursive: true });
});

const result = {
  label: "SFW",
  model: {
    revision: "54f4560bd9c5ee92d45dc30418a8f8680e80de6d",
    sha256: "8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689",
  },
  probabilities: { NSFL: 0.01, NSFW: 0.04, SFW: 0.95 },
  timing: { decodeMs: 1, inferenceMs: 2, queuedMs: 0, totalMs: 3 },
} satisfies Awaited<ReturnType<typeof evaluateSwiftformer>>;
function respond(body: unknown, status = 200) {
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request, options?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:3014/v1/classify");
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("content-type")).toBe(
        "image/jpeg"
      );
      return await Promise.resolve(Response.json(body, { status }));
    },
    { preconnect: originalFetch.preconnect }
  );
}

test("the app client sends prepared bytes and accepts the pinned model scores", async () => {
  respond(result);
  expect(await evaluateSwiftformer(imagePath)).toEqual(result);
});

test("overload and malformed scores stay unavailable instead of becoming safe results", async () => {
  respond({ error: "capacity_unavailable" }, 503);
  await expect(evaluateSwiftformer(imagePath)).rejects.toThrow("HTTP 503");
  respond({ ...result, probabilities: { NSFL: 0.9, NSFW: 0.9, SFW: 0.9 } });
  await expect(evaluateSwiftformer(imagePath)).rejects.toThrow(
    "invalid probabilities"
  );
  respond({ ...result, label: "NSFW" });
  await expect(evaluateSwiftformer(imagePath)).rejects.toThrow(
    "does not match"
  );
  respond({ ...result, model: { ...result.model, revision: "unverified" } });
  await expect(evaluateSwiftformer(imagePath)).rejects.toThrow();
});
