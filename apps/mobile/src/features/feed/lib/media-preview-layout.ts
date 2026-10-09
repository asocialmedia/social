import type { MediaBounds } from "../state/media-preview-store";

export function mediaPreviewLayout(
  window: { height: number; width: number },
  media: { height?: number | null; width?: number | null },
  topInset: number,
  measuredBounds?: MediaBounds,
  drawerTop: number = window.height * 0.6
): MediaBounds {
  const dimensions =
    media.width && media.height && media.width > 0 && media.height > 0
      ? media
      : measuredBounds;
  const ratio =
    dimensions?.width &&
    dimensions.height &&
    dimensions.width > 0 &&
    dimensions.height > 0
      ? dimensions.width / dimensions.height
      : 4 / 3;
  const top = Math.max(0, topInset) + 8;
  const maxWidth = Math.max(1, window.width - 16);
  const maxHeight = Math.max(1, Math.min(window.height, drawerTop) - top - 12);
  const width = Math.min(maxWidth, maxHeight * ratio);
  const height = width / ratio;
  return {
    height,
    width,
    x: (window.width - width) / 2,
    y: top + (maxHeight - height) / 2,
  };
}
