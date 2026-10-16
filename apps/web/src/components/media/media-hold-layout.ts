import { mediaAspect } from "@asm/ui/lib/post-preview-layout";
import type { PreviewMedia } from "@asm/ui/lib/post-preview-layout";

import type { MediaBounds } from "./media-hold-gesture";

export function mediaHoldPreviewLayout(
  viewport: { width: number; height: number; top: number },
  media: PreviewMedia,
  bounds: MediaBounds,
  sheetHeight: number
): MediaBounds {
  const ratio = mediaAspect(media, mediaAspect(bounds));
  const top = viewport.top + 8;
  const space = Math.max(1, viewport.height - sheetHeight - 20);
  const width = Math.min(Math.max(1, viewport.width - 16), space * ratio);
  const height = width / ratio;
  return {
    height,
    width,
    x: (viewport.width - width) / 2,
    y: top + (space - height) / 2,
  };
}
