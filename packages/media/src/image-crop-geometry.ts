export interface CropTransform {
  x: number;
  y: number;
  zoom: number;
}

export function profileCropGeometry(
  width: number,
  height: number,
  ratio: number,
  transform: CropTransform
) {
  if (width <= 0 || height <= 0 || ratio <= 0) {
    throw new Error("This image has no usable dimensions");
  }
  const zoom = Math.max(1, Math.min(3, transform.zoom));
  const cropWidth = Math.min(width, height * ratio) / zoom;
  const cropHeight = cropWidth / ratio;
  const x = Math.max(-1, Math.min(1, transform.x));
  const y = Math.max(-1, Math.min(1, transform.y));
  return {
    height: cropHeight,
    width: cropWidth,
    x: ((width - cropWidth) * (x + 1)) / 2,
    y: ((height - cropHeight) * (y + 1)) / 2,
  };
}

export interface CropRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rotatedImageSize(width: number, height: number, rotation = 0) {
  const quarterTurn = Math.abs(rotation % 180) === 90;
  return quarterTurn ? { height: width, width: height } : { height, width };
}
