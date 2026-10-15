import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const settings = {
  GOOGLE_CLOUD_VISION_API_KEY: "test-vision-key",
  OCR_ENABLED: true,
  OCR_TIMEOUT_MS: 30_000,
};
mock.module("../env", () => ({ workerEnv: settings }));
const {
  extractImageText,
  isOcrConfigured,
  OcrDeferredError,
  OCR_MODEL_VERSION,
} = await import("./ocr");
let directory: string;
let imagePath: string;
let request: { url: string; options?: RequestInit } | undefined;
let responseFactory = () => Promise.resolve(Response.json({ responses: [{}] }));
const fetchSpy = spyOn(globalThis, "fetch");

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "asm-vision-ocr-"));
  imagePath = path.join(directory, "poster.png");
  await Bun.write(imagePath, "test raster bytes");
});
beforeEach(() => {
  settings.OCR_ENABLED = true;
  settings.GOOGLE_CLOUD_VISION_API_KEY = "test-vision-key";
  request = undefined;
  responseFactory = () => Promise.resolve(Response.json({ responses: [{}] }));
  fetchSpy.mockImplementation(
    Object.assign(
      (
        url: Parameters<typeof fetch>[0],
        options?: Parameters<typeof fetch>[1]
      ) => {
        request = { options, url: String(url) };
        return responseFactory();
      },
      { preconnect: globalThis.fetch.preconnect }
    )
  );
});
afterEach(() => fetchSpy.mockClear());
afterAll(async () => {
  fetchSpy.mockRestore();
  await rm(directory, { force: true, recursive: true });
});

test("sends only TEXT_DETECTION and keeps credentials out of the URL", async () => {
  responseFactory = () =>
    Promise.resolve(
      Response.json({
        responses: [
          {
            fullTextAnnotation: { text: "Hello\n世界\n" },
            textAnnotations: [{ description: "duplicate" }],
          },
        ],
      })
    );
  expect(await extractImageText(imagePath)).toEqual({
    modelVersion: OCR_MODEL_VERSION,
    text: "Hello\n世界\n",
  });
  expect(request?.url).toBe("https://vision.googleapis.com/v1/images:annotate");
  expect(new Headers(request?.options?.headers).get("x-goog-api-key")).toBe(
    "test-vision-key"
  );
  expect(request?.options?.method).toBe("POST");
  expect(request?.options?.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(String(request?.options?.body))).toEqual({
    requests: [
      {
        features: [{ type: "TEXT_DETECTION" }],
        image: { content: Buffer.from("test raster bytes").toString("base64") },
      },
    ],
  });
});

test("uses the full annotation once rather than repeating individual words", async () => {
  responseFactory = () =>
    Promise.resolve(
      Response.json({
        responses: [
          {
            textAnnotations: [
              { description: "Hello world" },
              { description: "Hello" },
              { description: "world" },
            ],
          },
        ],
      })
    );
  const result = await extractImageText(imagePath);
  expect(result?.text).toBe("Hello world");
});

test("successful empty results differ from disabled extraction", async () => {
  expect(await extractImageText(imagePath)).toEqual({
    modelVersion: OCR_MODEL_VERSION,
    text: "",
  });
  settings.OCR_ENABLED = false;
  expect(isOcrConfigured()).toBe(false);
  expect(await extractImageText(imagePath)).toBeNull();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("missing credentials defer without making a request", async () => {
  settings.GOOGLE_CLOUD_VISION_API_KEY = "";
  expect(isOcrConfigured()).toBe(false);
  await expect(extractImageText(imagePath)).rejects.toBeInstanceOf(
    OcrDeferredError
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("oversized inline rasters fail before contacting the provider", async () => {
  const largePath = path.join(directory, "large.png");
  await Bun.write(largePath, new Uint8Array(7_000_001));
  await expect(extractImageText(largePath)).rejects.toThrow("7 MB");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([408, 429, 500, 503])(
  "HTTP %i defers using Retry-After",
  async (status) => {
    responseFactory = () =>
      Promise.resolve(
        new Response("provider detail", {
          headers: { "Retry-After": "120" },
          status,
        })
      );
    const now = Date.now();
    try {
      await extractImageText(imagePath);
      throw new Error("Expected deferral");
    } catch (error) {
      expect(error).toBeInstanceOf(OcrDeferredError);
      if (error instanceof OcrDeferredError) {
        expect(error.retryAt).toBeGreaterThanOrEqual(now + 120_000);
        expect(error.message).not.toContain("provider detail");
      }
    }
  }
);

test.each([401, 403])(
  "HTTP %i waits for configuration repair",
  async (status) => {
    responseFactory = () => Promise.resolve(new Response(null, { status }));
    await expect(extractImageText(imagePath)).rejects.toBeInstanceOf(
      OcrDeferredError
    );
  }
);

test("HTTP 200 per-image quota errors never become successful empty OCR", async () => {
  responseFactory = () =>
    Promise.resolve(
      Response.json({
        responses: [
          {
            error: { code: 8, message: "quota" },
            fullTextAnnotation: { text: "partial" },
          },
        ],
      })
    );
  await expect(extractImageText(imagePath)).rejects.toBeInstanceOf(
    OcrDeferredError
  );
});

test("permanent input errors fail without an infinite quota retry", async () => {
  responseFactory = () =>
    Promise.resolve(Response.json({ responses: [{ error: { code: 3 } }] }));
  await expect(extractImageText(imagePath)).rejects.toThrow("image error 3");
  responseFactory = () => Promise.resolve(new Response(null, { status: 400 }));
  await expect(extractImageText(imagePath)).rejects.toThrow("HTTP 400");
});

test("network failures and timeouts stay pending without leaking credentials", async () => {
  responseFactory = () => Promise.reject(new Error("test-vision-key"));
  await expect(extractImageText(imagePath)).rejects.toThrow(
    "request timed out or failed"
  );
});

test("malformed responses remain pending", async () => {
  for (const payload of [{}, { responses: [] }, { responses: [null] }]) {
    responseFactory = () => Promise.resolve(Response.json(payload));
    await expect(extractImageText(imagePath)).rejects.toBeInstanceOf(
      OcrDeferredError
    );
  }
  responseFactory = () => Promise.resolve(new Response("not JSON"));
  await expect(extractImageText(imagePath)).rejects.toBeInstanceOf(
    OcrDeferredError
  );
});
