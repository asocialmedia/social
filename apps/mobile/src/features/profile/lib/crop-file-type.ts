// The file a native crop is saved as. The crop engine encodes an opaque still
// as JPEG and keeps PNG only when the crop uses transparency (the shared
// @asm/media rule web follows), so the saved name and MIME type follow what
// was actually encoded rather than assuming PNG.
import { dataUrlMimeType } from "@asm/media/image-edit";

export function cropFileType(
  animated: boolean,
  dataUrl: string
): { extension: "gif" | "jpg" | "png"; mimeType: string } {
  if (animated) {
    return { extension: "gif", mimeType: "image/gif" };
  }
  if (dataUrlMimeType(dataUrl) === "image/jpeg") {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  return { extension: "png", mimeType: "image/png" };
}
