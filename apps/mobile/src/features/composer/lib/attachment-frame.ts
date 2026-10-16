export function attachmentFrame(
  {
    family,
    gust = false,
    height,
    isGif,
    width,
  }: {
    family: string;
    gust?: boolean;
    height?: number | null;
    isGif: boolean;
    width?: number | null;
  },
  availableWidth: number
): { height?: number; width: number } {
  if (family === "AUDIO") {
    return { width: availableWidth };
  }
  let ratio = width && height ? width / height : 1;
  if (gust) {
    ratio = 9 / 16;
  }
  let maxHeight = 380;
  if (family === "IMAGE") {
    maxHeight = isGif ? 280 : 320;
    if (!width || !height) {
      maxHeight = 176;
    }
  }
  const frameWidth = Math.max(1, Math.min(availableWidth, maxHeight * ratio));
  return { height: frameWidth / ratio, width: frameWidth };
}
