"use client";

// Whether cropped pixels actually use transparency, sampled on a downscaled
// copy so this stays cheap on a full-size image. An opaque crop can then be
// encoded as JPEG instead of carrying a needless alpha channel.
//
// Shared by every cropper in the app (avatars, banners, message attachments).
// Never encode WebP from a canvas: Chrome writes the extended VP8X form, which
// the media pipeline's Bun.Image decoder cannot read; PNG/JPEG are safe.
export function cropHasTransparency(source: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = 64;
  probe.height = 64;
  const context = probe.getContext("2d");
  if (!context) {
    return false;
  }
  context.drawImage(source, 0, 0, 64, 64);
  try {
    const { data } = context.getImageData(0, 0, 64, 64);
    // 250 rather than 255 so near-opaque anti-aliased edges still count.
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 250) {
        return true;
      }
    }
  } catch {
    // Treat an unreadable probe as opaque; JPEG is the safer default since a
    // needless alpha channel is the worse failure.
    return false;
  }
  return false;
}
