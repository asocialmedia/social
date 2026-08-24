// Pure upload-policy rules. Kept free of environment/database imports so
// they are unit-testable in isolation and usable from any runtime.

export type UploadPolicyStatus = 400 | 403 | 413 | 415 | 422 | 429 | 507;

export class UploadPolicyError extends Error {
  override name = "UploadPolicyError";
  status: UploadPolicyStatus;
  constructor(message: string, status: UploadPolicyStatus = 400) {
    super(message);
    this.status = status;
  }
}

const MIME_FAMILY_TO_TYPE: Record<string, "AUDIO" | "IMAGE" | "VIDEO"> = {
  audio: "AUDIO",
  image: "IMAGE",
  video: "VIDEO",
};

export function mediaTypeFromMime(
  declaredMime: string
): "AUDIO" | "IMAGE" | "VIDEO" {
  const family = declaredMime.split("/")[0]?.toLowerCase() ?? "";
  const mapped = MIME_FAMILY_TO_TYPE[family];
  if (!mapped) {
    throw new UploadPolicyError(`Unsupported file type: ${declaredMime}`, 415);
  }
  // SVG and text-like payloads are hard-blocked product-wide.
  if (declaredMime === "image/svg+xml" || declaredMime.startsWith("text/")) {
    throw new UploadPolicyError(`Unsupported file type: ${declaredMime}`, 415);
  }
  return mapped;
}

// Display-safe copy of the user's filename: metadata lives in the database,
// never in object keys or URLs.
export function sanitizeDisplayName(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}
