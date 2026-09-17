"use client";

// Turns a cropper's Blob output into the File the media pipeline receives.
//
// The extension and MIME come from the blob itself rather than a hardcoded
// "image/webp". That hardcode was a real bug: a canvas encode with type
// "image/webp" produces the EXTENDED WebP form (a VP8X chunk - Chrome includes
// an ICC profile, so it never emits simple VP8), and the pipeline's decoder
// (Bun.Image) cannot read VP8X. It reports -1x-1 and the job dies with
// "unrecognised format", so every cropped avatar/banner upload failed.
//
// CropImageDialog therefore emits PNG when the crop has transparency and JPEG
// otherwise, both of which the decoder handles.
export function croppedImageFile(blob: Blob, baseName: string): File {
  const extension = blob.type === "image/png" ? "png" : "jpg";
  return new File([blob], `${baseName}.${extension}`, { type: blob.type });
}
