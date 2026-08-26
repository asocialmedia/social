// Scene-text OCR (RapidOCR-class): PaddleOCR PP-OCRv4 ONNX models executed by
// onnxruntime-node via @gutenye/ocr-node. Runs on the poster/thumb derivative
// during the analyze stage; output lands in Media.ocrText as input for
// alt-text assist and text-based moderation. The engine loads lazily so
// environments with OCR disabled skip cleanly, and every runtime failure
// degrades to null - analysis never blocks on OCR.

import { workerEnv } from "./env";

export const OCR_MODEL_VERSION = "ppocrv4-onnx-v1";

export interface OcrResult {
  modelVersion: string;
  // Line texts joined with newlines, in reading order. Empty when the image
  // carries no readable text.
  text: string;
}

interface OcrLineLike {
  score?: number;
  text?: string;
}

interface OcrEngineLike {
  detect: (source: string) => Promise<unknown>;
}

let engine: OcrEngineLike | null = null;
let engineFailed = false;

async function getEngine(): Promise<OcrEngineLike | null> {
  if (engine || engineFailed) {
    return engine;
  }
  if (!workerEnv.OCR_ENABLED) {
    engineFailed = true;
    return null;
  }
  try {
    const ocrModule = (await import("@gutenye/ocr-node")) as unknown as {
      default: { create: () => Promise<OcrEngineLike> };
    };
    engine = await ocrModule.default.create();
    return engine;
  } catch (error) {
    console.error("OCR engine failed to load:", error);
    engineFailed = true;
    return null;
  }
}

export async function extractImageText(
  imagePath: string
): Promise<OcrResult | null> {
  const instance = await getEngine();
  if (!instance) {
    return null;
  }
  try {
    const detected = (await instance.detect(imagePath)) as OcrLineLike[];
    const lines = (Array.isArray(detected) ? detected : [])
      .map((line) => ({
        score: Number(line.score ?? 0),
        text: (line.text ?? "").trim(),
      }))
      .filter((line) => line.text.length > 0);
    return {
      modelVersion: OCR_MODEL_VERSION,
      text: lines.map((line) => line.text).join("\n"),
    };
  } catch (error) {
    console.error(`OCR failed for ${imagePath}:`, error);
    return null;
  }
}

export function isOcrConfigured(): boolean {
  return workerEnv.OCR_ENABLED;
}
