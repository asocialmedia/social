export function gustPreviewGeometry(
  width: number,
  height: number,
  topInset: number,
  aspectRatio: number
) {
  const ratio =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 9 / 16;
  const availableHeight = Math.max(0, height / 2 - topInset - 16);
  const previewWidth = Math.min(
    Math.max(0, width - 16),
    availableHeight * ratio
  );
  const previewHeight = previewWidth / ratio;
  return {
    height: previewHeight,
    marginTop: topInset + 8 + (availableHeight - previewHeight) / 2,
    width: previewWidth,
  };
}
