import { createHash } from "node:crypto";

export function embeddingInputFingerprint(
  model: string,
  text: string,
  media: unknown = null
): string {
  return createHash("sha256")
    .update(JSON.stringify([model, text, media]))
    .digest("hex");
}
