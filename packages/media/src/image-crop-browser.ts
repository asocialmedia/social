// oxlint-disable-next-line typescript/triple-slash-reference -- Include the narrow gifenc declaration for every workspace consumer.
/// <reference path="./gifenc.d.ts" />
// oxlint-disable promise/avoid-new -- Browser timers and FileReader expose callback APIs.
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { decompressFrame, parseGIF } from "gifuct-js";

import { profileCropGeometry, rotatedImageSize } from "./image-crop-geometry";
import type { CropTransform, CropRectangle } from "./image-crop-geometry";

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Image processing is unavailable");
  }
  return { context, element };
}

export async function encodeProfileCrop(
  dataUrl: string,
  animated: boolean,
  ratio: number,
  transform: CropTransform,
  options: {
    rotation?: number;
    outputWidth?: number;
    crop?: CropRectangle;
  } = {}
) {
  const image = new window.Image();
  image.src = dataUrl;
  await image.decode();
  const rotation = options.rotation ?? 0;
  const dimensions = rotatedImageSize(
    image.naturalWidth,
    image.naturalHeight,
    rotation
  );
  const crop =
    options.crop ??
    profileCropGeometry(dimensions.width, dimensions.height, ratio, transform);
  if (
    !Number.isFinite(crop.width) ||
    !Number.isFinite(crop.height) ||
    crop.width <= 0 ||
    crop.height <= 0
  ) {
    throw new Error("Choose a crop area before saving");
  }
  const outputWidth = Math.max(
    1,
    Math.round(options.outputWidth ?? (ratio === 1 ? 512 : 1500))
  );
  const outputHeight = Math.max(
    1,
    Math.round((outputWidth * crop.height) / crop.width)
  );
  if (outputWidth * outputHeight > 4_000_000) {
    throw new Error("That crop is too large. Choose a wider crop area.");
  }
  const rotated = canvas(dimensions.width, dimensions.height);
  const output = canvas(outputWidth, outputHeight);
  const draw = (source: CanvasImageSource) => {
    output.context.clearRect(0, 0, outputWidth, outputHeight);
    rotated.context.clearRect(0, 0, dimensions.width, dimensions.height);
    rotated.context.save();
    rotated.context.translate(dimensions.width / 2, dimensions.height / 2);
    rotated.context.rotate((rotation * Math.PI) / 180);
    rotated.context.drawImage(
      source,
      -image.naturalWidth / 2,
      -image.naturalHeight / 2
    );
    rotated.context.restore();
    output.context.drawImage(
      rotated.element,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      outputWidth,
      outputHeight
    );
  };
  if (!animated) {
    draw(image);
    return output.element.toDataURL("image/png");
  }
  const response = await fetch(dataUrl);
  const bytes = await response.arrayBuffer();
  const parsed = parseGIF(bytes);
  if (parsed.lsd.width * parsed.lsd.height > 16_000_000) {
    throw new Error(
      "That GIF is too large to crop on this device. Try a smaller one."
    );
  }
  const frames = parsed.frames.filter((frame) => "image" in frame);
  if (
    frames.length *
      Math.max(
        parsed.lsd.width * parsed.lsd.height,
        outputWidth * outputHeight
      ) >
    120_000_000
  ) {
    throw new Error(
      "That GIF is too complex to crop on this device. Try a smaller one."
    );
  }
  const source = canvas(parsed.lsd.width, parsed.lsd.height);
  const encoder = GIFEncoder();
  const loop = parsed.frames
    .filter((frame) => "application" in frame)
    .find((frame) => frame.application.id === "NETSCAPE2.0")
    ?.application.blocks;
  const repeat = loop && loop.length >= 3 ? loop[1] + loop[2] * 256 : -1;
  let previous: ReturnType<typeof decompressFrame> | undefined;
  let restored: ImageData | undefined;
  for (const raw of frames) {
    if (previous?.disposalType === 2) {
      const { left, top, width, height } = previous.dims;
      source.context.clearRect(left, top, width, height);
    } else if (previous?.disposalType === 3 && restored) {
      source.context.putImageData(restored, 0, 0);
    }
    const frame = decompressFrame(raw, parsed.gct, true);
    restored =
      frame.disposalType === 3
        ? source.context.getImageData(
            0,
            0,
            source.element.width,
            source.element.height
          )
        : undefined;
    const patch = canvas(frame.dims.width, frame.dims.height);
    const patchData = patch.context.createImageData(
      frame.dims.width,
      frame.dims.height
    );
    patchData.data.set(frame.patch);
    patch.context.putImageData(patchData, 0, 0);
    source.context.drawImage(patch.element, frame.dims.left, frame.dims.top);
    draw(source.element);
    const rgba = output.context.getImageData(
      0,
      0,
      outputWidth,
      outputHeight
    ).data;
    const palette = quantize(rgba, 256, {
      format: "rgba4444",
      oneBitAlpha: true,
    });
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    encoder.writeFrame(
      applyPalette(rgba, palette, "rgba4444"),
      outputWidth,
      outputHeight,
      {
        delay: frame.delay,
        dispose: 2,
        palette,
        repeat,
        transparent: transparentIndex !== -1,
        transparentIndex: Math.max(0, transparentIndex),
      }
    );
    previous = frame;
    // Yield between frames so the WebView can continue delivering messages.
    // oxlint-disable-next-line no-await-in-loop -- Disposal depends on the previous frame and yields bound UI work.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  encoder.finish();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        resolve(String(reader.result));
      },
      { once: true }
    );
    reader.addEventListener(
      "error",
      () => {
        reject(new Error("Couldn't save the cropped GIF"));
      },
      { once: true }
    );
    reader.readAsDataURL(new Blob([encoder.bytes()], { type: "image/gif" }));
  });
}

export async function encodeAnimatedCrop(
  src: string,
  crop: CropRectangle & { rotate?: number },
  maxWidth = 1500
) {
  const dataUrl = await encodeProfileCrop(
    src,
    true,
    crop.width / crop.height,
    { x: 0, y: 0, zoom: 1 },
    {
      crop,
      outputWidth: Math.min(maxWidth, Math.round(crop.width)),
      rotation: crop.rotate ?? 0,
    }
  );
  const response = await fetch(dataUrl);
  return await response.blob();
}
