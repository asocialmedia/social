import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cache = new Map<string, string>();
const environment = {
  CLASSIFIER_API_TOKEN: "configured",
  CLASSIFIER_URL: "https://classifier.test",
  EXTERNAL_CLEF_ENABLED: true,
};
let localCalls = 0;
let contextualCalls = 0;
let localUnavailable = false;
let contextualUnavailable = false;
let claimAvailable = true;
let readCount = 0;
let failRead = 0;
let failResultWrite = false;
let inferenceGate: Promise<void> | null = null;
let inferenceStarted: (() => void) | null = null;
const setCache = mock((key: string, value: string, ...options: unknown[]) => {
  if (
    key.endsWith(":lock") &&
    (!claimAvailable || (options.includes("NX") && cache.has(key)))
  ) {
    return Promise.resolve(null);
  }
  if (!key.endsWith(":lock") && failResultWrite) {
    return Promise.reject(new Error("Redis write unavailable"));
  }
  cache.set(key, value);
  return Promise.resolve("OK");
});
const evaluateClaim = mock(
  (
    script: string,
    _count: number,
    key: string,
    owner: string,
    _ttl?: number
  ) => {
    if (cache.get(key) !== owner) {
      return Promise.resolve(0);
    }
    if (!script.includes("pexpire")) {
      cache.delete(key);
    }
    return Promise.resolve(1);
  }
);
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
    eval: evaluateClaim,
    get: (key: string) => {
      readCount += 1;
      return readCount === failRead
        ? Promise.reject(new Error("Redis read unavailable"))
        : Promise.resolve(cache.get(key) ?? null);
    },
    set: setCache,
  },
}));
mock.module("../../env", () => ({ workerEnv: environment }));
mock.module("../classification/swiftformer", () => ({
  evaluateSwiftformer: async () => {
    localCalls += 1;
    inferenceStarted?.();
    if (inferenceGate) {
      await inferenceGate;
    }
    if (localUnavailable) {
      throw new Error("overloaded");
    }
    return structuredClone(result);
  },
  parseSwiftformerResult: (input: unknown) => {
    if (!input || typeof input !== "object" || !("model" in input)) {
      throw new Error("invalid");
    }
    return input as typeof result;
  },
}));
mock.module("../classification/clef", () => ({
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
afterEach(() => {
  jest.useRealTimers();
});
beforeEach(() => {
  environment.EXTERNAL_CLEF_ENABLED = true;
  claimAvailable = true;
  readCount = 0;
  failRead = 0;
  failResultWrite = false;
  inferenceGate = null;
  inferenceStarted = null;
  setCache.mockClear();
  evaluateClaim.mockClear();
  cache.clear();
  localCalls = 0;
  contextualCalls = 0;
  localUnavailable = false;
  contextualUnavailable = false;
  environment.CLASSIFIER_URL = "https://classifier.test";
  result.label = "SFW";
  result.probabilities = { NSFL: 0.02, NSFW: 0.05, SFW: 0.93 };
});

test("another replica's image claim defers without inference or remote spending", async () => {
  claimAvailable = false;
  await expect(assessExternalImages([image], "post")).rejects.toMatchObject({
    name: "ClassifierDeferredError",
  });
  expect(localCalls).toBe(0);
  expect(contextualCalls).toBe(0);
  expect(setCache).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    "PX",
    30_000,
    "NX"
  );
});

test("an existing image owner cannot be overwritten or released by another replica", async () => {
  const key = `external:swiftformer:v1:54f4560bd9c5ee92d45dc30418a8f8680e80de6d:${createHash("sha256").update("image bytes").digest("hex")}:lock`;
  cache.set(key, "another-owner");
  await expect(assessExternalImages([image], "post")).rejects.toMatchObject({
    name: "ClassifierDeferredError",
  });
  expect(cache.get(key)).toBe("another-owner");
  expect(localCalls).toBe(0);
});

test.each(["recheck", "write"])(
  "Redis %s failures defer assessment instead of consuming job attempts",
  async (phase) => {
    if (phase === "recheck") {
      failRead = 2;
    } else {
      failResultWrite = true;
    }
    await expect(assessExternalImages([image], "post")).rejects.toMatchObject({
      name: "ClassifierDeferredError",
    });
    expect(
      [...cache.keys()].filter((key) => key.endsWith(":lock"))
    ).toHaveLength(0);
  }
);

test("a long-running assessment renews its owner-checked image claim until completion", async () => {
  jest.useFakeTimers();
  const started = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  inferenceGate = gate.promise;
  inferenceStarted = () => started.resolve();
  const assessment = assessExternalImages([image], "post");
  await started.promise;
  jest.advanceTimersByTime(10_000);
  await Promise.resolve();
  await Promise.resolve();
  expect(evaluateClaim).toHaveBeenCalledWith(
    expect.stringContaining("pexpire"),
    1,
    expect.any(String),
    expect.any(String),
    30_000
  );
  gate.resolve();
  expect(await assessment).toBe("safe");
  expect([...cache.keys()].filter((key) => key.endsWith(":lock"))).toHaveLength(
    0
  );
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

test("concurrent identical images share one local inference", async () => {
  environment.EXTERNAL_CLEF_ENABLED = false;
  expect(
    await Promise.all([
      assessExternalImages([image], "one"),
      assessExternalImages([image], "two"),
      assessExternalImages([image], "three"),
    ])
  ).toEqual(["safe", "safe", "safe"]);
  expect(localCalls).toBe(1);
  expect(contextualCalls).toBe(0);
});

test("local-only ambiguity stays uncertain and missing local configuration never spends remotely", async () => {
  environment.EXTERNAL_CLEF_ENABLED = false;
  result.probabilities = { NSFL: 0.03, NSFW: 0.08, SFW: 0.89 };
  expect(await assessExternalImages([image], "post")).toBe("uncertain");
  environment.CLASSIFIER_URL = "";
  expect(await assessExternalImages([image], "post")).toBe("uncertain");
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
