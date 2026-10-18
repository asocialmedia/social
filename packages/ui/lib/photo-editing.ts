export interface PhotoPoint {
  x: number;
  y: number;
}

export interface PhotoGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  rotate?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface PhotoStroke {
  color: string;
  width: number;
  tool: "pen" | "highlight";
  points: PhotoPoint[];
}

export const PHOTO_LOOKS = [
  {
    brightness: 0,
    contrast: 0,
    id: "original",
    label: "Original",
    saturation: 0,
    warmth: 0,
  },
  {
    brightness: 3,
    contrast: 14,
    id: "vivid",
    label: "Vivid",
    saturation: 22,
    warmth: 0,
  },
  {
    brightness: 8,
    contrast: -12,
    id: "soft",
    label: "Soft",
    saturation: -8,
    warmth: 3,
  },
  {
    brightness: 3,
    contrast: 4,
    id: "warm",
    label: "Warm",
    saturation: 8,
    warmth: 18,
  },
  {
    brightness: 2,
    contrast: 7,
    id: "cool",
    label: "Cool",
    saturation: -5,
    warmth: -18,
  },
  {
    brightness: 2,
    contrast: 12,
    id: "mono",
    label: "Mono",
    saturation: -100,
    warmth: 0,
  },
] as const;

export type PhotoLook = (typeof PHOTO_LOOKS)[number]["id"];
export interface PhotoAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}
export const DEFAULT_PHOTO_ADJUSTMENTS: PhotoAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
};
export const MAX_PHOTO_STROKES = 100;
export const MAX_PHOTO_STROKE_POINTS = 2048;

export type PhotoCropAction =
  | "left"
  | "right"
  | "flip"
  | "reset"
  | "free"
  | "square"
  | "portrait"
  | "wide";
interface PhotoCropperAdapter {
  getData: () => Omit<PhotoGeometry, "naturalWidth" | "naturalHeight">;
  getImageData: () => { naturalWidth: number; naturalHeight: number };
  getCroppedCanvas: (options: {
    maxWidth: number;
    maxHeight: number;
    imageSmoothingQuality: "high";
  }) => HTMLCanvasElement;
  rotate: (degrees: number) => unknown;
  scaleX: (scale: number) => unknown;
  reset: () => unknown;
  setAspectRatio: (ratio: number) => unknown;
}

export function capturePhotoSnapshot(cropper: PhotoCropperAdapter | undefined) {
  if (!cropper) {
    throw new Error("Wait for your photo to load");
  }
  const crop = cropper.getData();
  if (!(crop.width > 0) || !(crop.height > 0)) {
    throw new Error("Choose a crop area before saving");
  }
  const image = cropper.getImageData();
  const canvas = cropper.getCroppedCanvas({
    imageSmoothingQuality: "high",
    maxHeight: 2000,
    maxWidth: 2000,
  });
  if (!canvas?.width || !canvas.height) {
    throw new Error("Couldn't prepare this photo. Try a smaller image.");
  }
  return {
    canvas,
    geometry: {
      ...crop,
      naturalHeight: image.naturalHeight,
      naturalWidth: image.naturalWidth,
    },
  };
}

export function applyPhotoCropAction(
  cropper: PhotoCropperAdapter | undefined,
  action: PhotoCropAction
) {
  if (!cropper) {
    return;
  }
  if (action === "left" || action === "right") {
    cropper.rotate(action === "left" ? -90 : 90);
  } else if (action === "flip") {
    cropper.scaleX(-(cropper.getData().scaleX ?? 1));
  } else if (action === "reset") {
    cropper.setAspectRatio(Number.NaN);
    cropper.reset();
  } else {
    cropper.setAspectRatio(
      { free: Number.NaN, portrait: 4 / 5, square: 1, wide: 16 / 9 }[action]
    );
  }
}

function geometryTransform(geometry: PhotoGeometry) {
  const radians = ((geometry.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    cos,
    height:
      Math.abs(geometry.naturalWidth * sin) +
      Math.abs(geometry.naturalHeight * cos),
    sin,
    width:
      Math.abs(geometry.naturalWidth * cos) +
      Math.abs(geometry.naturalHeight * sin),
  };
}

// Marks live in original-image coordinates so recropping, rotating and flipping keep them aligned.
export function photoPointToSource(
  point: PhotoPoint,
  geometry: PhotoGeometry
): PhotoPoint {
  const transform = geometryTransform(geometry);
  const x = geometry.x + point.x * geometry.width - transform.width / 2;
  const y = geometry.y + point.y * geometry.height - transform.height / 2;
  return {
    x:
      (x * transform.cos + y * transform.sin) /
        (geometry.scaleX ?? 1) /
        geometry.naturalWidth +
      0.5,
    y:
      (-x * transform.sin + y * transform.cos) /
        (geometry.scaleY ?? 1) /
        geometry.naturalHeight +
      0.5,
  };
}

export function sourcePointToPhoto(
  point: PhotoPoint,
  geometry: PhotoGeometry
): PhotoPoint {
  const transform = geometryTransform(geometry);
  const x = (point.x - 0.5) * geometry.naturalWidth * (geometry.scaleX ?? 1);
  const y = (point.y - 0.5) * geometry.naturalHeight * (geometry.scaleY ?? 1);
  return {
    x:
      (x * transform.cos -
        y * transform.sin +
        transform.width / 2 -
        geometry.x) /
      geometry.width,
    y:
      (x * transform.sin +
        y * transform.cos +
        transform.height / 2 -
        geometry.y) /
      geometry.height,
  };
}

export function applyPhotoPixels(
  pixels: Uint8ClampedArray,
  look: PhotoLook,
  adjustments: PhotoAdjustments
) {
  const preset = PHOTO_LOOKS.find((item) => item.id === look) ?? PHOTO_LOOKS[0];
  const brightness = (preset.brightness + adjustments.brightness) * 2.55;
  const contrast = 1 + (preset.contrast + adjustments.contrast) / 100;
  const saturation = Math.max(
    0,
    1 + (preset.saturation + adjustments.saturation) / 100
  );
  const warmth = (preset.warmth + adjustments.warmth) * 0.65;
  if (!brightness && contrast === 1 && saturation === 1 && !warmth) {
    return;
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const red = (pixels[i] - 127.5) * contrast + 127.5 + brightness;
    const green = (pixels[i + 1] - 127.5) * contrast + 127.5 + brightness;
    const blue = (pixels[i + 2] - 127.5) * contrast + 127.5 + brightness;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    pixels[i] = luminance + (red - luminance) * saturation + warmth;
    pixels[i + 1] = luminance + (green - luminance) * saturation;
    pixels[i + 2] = luminance + (blue - luminance) * saturation - warmth;
  }
}

export function drawPhotoStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly PhotoStroke[],
  geometry: PhotoGeometry
) {
  const { width, height } = context.canvas;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    context.globalAlpha = stroke.tool === "highlight" ? 0.35 : 1;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = Math.max(
      0.5,
      ((stroke.width * geometry.naturalWidth) / geometry.width) * width
    );
    context.beginPath();
    for (const [index, point] of stroke.points.entries()) {
      const mapped = sourcePointToPhoto(point, geometry);
      if (index === 0) {
        context.moveTo(mapped.x * width, mapped.y * height);
      } else {
        context.lineTo(mapped.x * width, mapped.y * height);
      }
    }
    if (stroke.points.length === 1) {
      const point = sourcePointToPhoto(stroke.points[0], geometry);
      context.arc(
        point.x * width,
        point.y * height,
        context.lineWidth / 2,
        0,
        Math.PI * 2
      );
      context.fill();
    } else {
      context.stroke();
    }
  }
  context.restore();
}

export function renderPhotoEdits(
  source: HTMLCanvasElement,
  look: PhotoLook,
  adjustments: PhotoAdjustments
) {
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d");
  if (!context) {
    throw new Error("Image editing is unavailable on this device");
  }
  context.drawImage(source, 0, 0);
  if (look !== "original" || Object.values(adjustments).some(Boolean)) {
    const image = context.getImageData(0, 0, output.width, output.height);
    applyPhotoPixels(image.data, look, adjustments);
    context.putImageData(image, 0, 0);
  }
  return output;
}

export function shouldAutoEditPhoto(
  selectedCount: number,
  accepted: readonly { kind: string }[]
) {
  return (
    selectedCount === 1 && accepted.length === 1 && accepted[0].kind === "image"
  );
}
