// Pure geometry and errors for the profile image flow, kept free of React
// Native and Expo imports so they are unit-testable on Node. Same convention as
// ./api-base.ts and the install-token helpers: anything that can be a plain
// function lives here, and the module that touches native modules imports it.

export interface Size {
  height: number;
  width: number;
}

export interface CropRect {
  height: number;
  originX: number;
  originY: number;
  width: number;
}

// Web's numbers, from profile-media-inputs.tsx: the avatar resizes a 1024
// canvas down to a 512 square, the banner works and stays at 1500x500.
export const PROFILE_IMAGE_TARGETS: Record<"avatar" | "banner", Size> = {
  avatar: { height: 512, width: 512 },
  banner: { height: 500, width: 1500 },
};

/** Web rejects anything over 10MB before doing any work. */
export const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export type ProfileImageKind = keyof typeof PROFILE_IMAGE_TARGETS;

/**
 * The cover-crop web's CropImageDialog performs: scale so the target ratio is
 * fully covered, then take the centred window at the target size. This decides
 * both the output dimensions and the framing, which is why it is exported and
 * pinned by tests rather than buried in the picker flow.
 */
export function coverCrop(
  target: Size,
  source: Size
): CropRect & { scale: number } {
  // A source with a zero or non-finite edge would make the scale 0/0 = NaN, and
  // every downstream dimension would follow. Treating it as already the target
  // size turns the crop into a no-op, which is the safe outcome: the image is
  // re-encoded at the right dimensions rather than cropped to nothing.
  const usable =
    source.height > 0 && source.width > 0
      ? source
      : { height: target.height, width: target.width };
  const ratio = target.width / target.height;
  const scale =
    usable.width / usable.height > ratio
      ? target.height / usable.height
      : target.width / usable.width;
  const scaledWidth = Math.max(Math.round(usable.width * scale), 1);
  const scaledHeight = Math.max(Math.round(usable.height * scale), 1);
  const cropWidth = Math.min(scaledWidth, target.width);
  const cropHeight = Math.min(scaledHeight, target.height);
  return {
    height: cropHeight,
    originX: Math.round((scaledWidth - cropWidth) / 2),
    originY: Math.round((scaledHeight - cropHeight) / 2),
    scale,
    width: cropWidth,
  };
}

/** True when the picked file is over web's limit. */
export function isTooLarge(bytes: number): boolean {
  return bytes > PROFILE_IMAGE_MAX_BYTES;
}

/**
 * Web routes GIFs to a separate centering dialog because both its resizer and
 * its crop flatten animation. Native has no such dialog, so an animated source
 * is rejected outright rather than silently uploaded as a still frame.
 */
export function isAnimatedImage(
  mimeType: string | undefined,
  name: string
): boolean {
  return mimeType === "image/gif" || name.toLowerCase().endsWith(".gif");
}

export class ProfileImageError extends Error {
  readonly reason: "too-large" | "unusable";

  constructor(reason: "too-large" | "unusable", message: string) {
    super(message);
    this.name = "ProfileImageError";
    this.reason = reason;
  }
}
