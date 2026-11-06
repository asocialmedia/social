import { createHash, randomUUID } from "node:crypto";
import { writeFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { model } from "../src/inference/model";

const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/onnx/image-safety-classifier-xs.onnx`;
const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) {
  throw new Error(`Model download HTTP ${response.status}`);
}
const bytes = Buffer.from(await response.arrayBuffer());
if (
  bytes.byteLength !== model.bytes ||
  createHash("sha256").update(bytes).digest("hex") !== model.sha256
) {
  throw new Error("Downloaded model checksum mismatch");
}
const path =
  process.env.CLASSIFIER_MODEL_PATH ??
  fileURLToPath(new URL("../model.onnx", import.meta.url));
const temporary = `${path}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, path);
} finally {
  await rm(temporary, { force: true });
}
console.info(
  JSON.stringify({
    bytes: bytes.byteLength,
    event: "model.verified",
    sha256: model.sha256,
  })
);
