export type ImageCachePolicy = "memory" | "memory-disk";

// Animated originals are deliberately kept out of disk cache. They can be
// large and are commonly short-lived, while still images benefit from both
// caches when the user returns to a feed or profile.
export function imageCachePolicy(
  uri: string | null | undefined,
  isGif = false
): ImageCachePolicy {
  if (isGif || (uri && /\.gif(?:[?#].*)?$/i.test(uri))) {
    return "memory";
  }
  return "memory-disk";
}
