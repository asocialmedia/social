import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cache = new Map<string, string>();
const environment = {
  CLASSIFIER_API_TOKEN: "configured",
  CLASSIFIER_URL: "https://classifier.test",
};
let localCalls = 0;
let contextualCalls = 0;
let localUnavailable = false;
let contextualUnavailable = false;
const result = {
  label: "SFW" as "SFW" | "NSFW" | "NSFL",
  model: {
    revision: "54f4560bd9c5ee92d45dc30418a8f8680e80de6d" as const,
    sha256:
      "8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689" as const,
  },
  probabilities: { NSFL: 0.02, NSFW: 0.05, SFW: 0.93 },
  timing: { decodeMs: 1, inferenceMs: 2, queuedMs: 0, totalMs: 3 },
};
mock.module("@asm/db", () => ({
  redis: {
    get: (key: string) => Promise.resolve(cache.get(key) ?? null),
    set: (key: string, value: string) => {
      cache.set(key, value);
      return Promise.resolve("OK");
    },
  },
}));
mock.module("../env", () => ({ workerEnv: environment }));
mock.module("./swiftformer", () => ({
  evaluateSwiftformer: () => {
    localCalls += 1;
    return localUnavailable
      ? Promise.reject(new Error("overloaded"))
      : Promise.resolve(structuredClone(result));
  },
  parseSwiftformerResult: (input: unknown) => {
    if (!input || typeof input !== "object" || !("model" in input)) {
      throw new Error("invalid");
    }
    return input as typeof result;
  },
}));
mock.module("./clef", () => ({
  evaluateClef: () => {
    contextualCalls += 1;
    if (contextualUnavailable) {
      return Promise.reject(new Error("free allowance exhausted"));
    }
    return Promise.resolve({
      probabilities: {
        explicit: 0.01,
        graphic_violence: 0.01,
        sexualized: 0.01,
      },
    });
  },
}));
const { assessExternalImages, swiftformerVisualVerdict } =
  await import("./external-image-assessment");
let directory = "";
let image = "";
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "asm-external-policy-"));
  image = path.join(directory, "image.jpg");
  await writeFile(image, "image bytes");
});
afterAll(() => rm(directory, { force: true, recursive: true }));
beforeEach(() => {
  cache.clear();
  localCalls = 0;
  contextualCalls = 0;
  localUnavailable = false;
  contextualUnavailable = false;
  environment.CLASSIFIER_URL = "https://classifier.test";
  result.label = "SFW";
  result.probabilities = { NSFL: 0.02, NSFW: 0.05, SFW: 0.93 };
});

test("clear local scores use a content cache shared across file paths without spending contextual allowance", async () => {
  contextualUnavailable = true;
  expect(await assessExternalImages([image], "post")).toBe("safe");
  const copy = path.join(directory, "copy.jpg");
  await writeFile(copy, "image bytes");
  expect(await assessExternalImages([copy], "different post")).toBe("safe");
  expect(localCalls).toBe(1);
  expect(contextualCalls).toBe(0);
});

test("ambiguous scores need contextual assessment and its failure never approves content", async () => {
  result.probabilities = { NSFL: 0.03, NSFW: 0.08, SFW: 0.89 };
  expect(await assessExternalImages([image], "post")).toBe("safe");
  expect(contextualCalls).toBe(1);
  contextualUnavailable = true;
  await expect(assessExternalImages([image], "post")).rejects.toThrow(
    "allowance exhausted"
  );
});

test("explicit and gore-risk scores stay withheld and local endpoint failures never become safe", async () => {
  result.label = "NSFW";
  result.probabilities = { NSFL: 0.02, NSFW: 0.91, SFW: 0.07 };
  expect(await assessExternalImages([image], "post")).toBe("explicit");
  expect(
    swiftformerVisualVerdict({
      ...result,
      label: "SFW",
      probabilities: { NSFL: 0.11, NSFW: 0.01, SFW: 0.88 },
    })
  ).toBe("explicit");
  expect(contextualCalls).toBe(0);
  cache.clear();
  localUnavailable = true;
  await expect(assessExternalImages([image], "post")).rejects.toThrow(
    "overloaded"
  );
  expect(contextualCalls).toBe(0);
});

test("absent local configuration retains contextual policy; an empty image set cannot pass", async () => {
  environment.CLASSIFIER_URL = "";
  expect(await assessExternalImages([image], "post")).toBe("safe");
  expect(localCalls).toBe(0);
  expect(contextualCalls).toBe(1);
  await expect(assessExternalImages([], "post")).rejects.toThrow(
    "requires an image"
  );
});
