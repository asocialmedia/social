// Pure guards and errors for the profile image flow, kept free of React Native
// and Expo imports so they are unit-testable on Node. Same convention as
// ./api-base.ts and the install-token helpers: anything that can be a plain
// function lives here, and the module that touches native modules imports it.

/** Web rejects anything over 10MB before doing any work. */
export const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** The ratio each profile surface renders at. */
export const PROFILE_IMAGE_RATIO = {
  avatar: 1,
  banner: 3,
} as const;

export type ProfileImageKind = keyof typeof PROFILE_IMAGE_RATIO;

export type ProfileImageErrorReason = "too-large" | "unusable";

export class ProfileImageError extends Error {
  readonly reason: ProfileImageErrorReason;

  constructor(reason: ProfileImageErrorReason, message: string) {
    super(message);
    this.name = "ProfileImageError";
    this.reason = reason;
  }
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
  // MIME types are case-insensitive, and pickers have been known to report
  // "image/GIF", so the comparison is normalised rather than exact.
  return (
    mimeType?.trim().toLowerCase() === "image/gif" ||
    name.toLowerCase().endsWith(".gif")
  );
}

/**
 * How far a pick's aspect ratio sits from what the surface renders at, as a
 * 0..1 fraction. Informational only: a banner that is not 3:1 still renders
 * correctly under contentFit cover, it just stores more than it shows. Used to
 * decide whether a drift is worth logging, never to crop.
 */
export function ratioDrift(
  kind: ProfileImageKind,
  width: number,
  height: number
): number {
  if (width <= 0 || height <= 0) {
    return 0;
  }
  const target = PROFILE_IMAGE_RATIO[kind];
  return Math.abs(width / height - target) / target;
}
