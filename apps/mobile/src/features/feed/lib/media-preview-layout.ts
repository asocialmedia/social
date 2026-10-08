import type { MediaBounds } from "../state/media-preview-store";

export function mediaPreviewLayout(
  window: { height: number; width: number },
  media: { height?: number | null; width?: number | null },
  topInset: number
): MediaBounds {
  const ratio =
    media.width && media.height && media.width > 0 && media.height > 0
      ? media.width / media.height
      : 4 / 3;
  const maxWidth = Math.max(1, window.width - 32);
  const maxHeight = Math.max(1, window.height * 0.53 - topInset - 24);
  const width = Math.min(maxWidth, maxHeight * ratio);
  const height = width / ratio;
  return {
    height,
    width,
    x: (window.width - width) / 2,
    y: topInset + 16 + (maxHeight - height) / 2,
  };
}
