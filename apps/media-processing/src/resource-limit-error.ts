// Raised when a probed stream exceeds a decoder safety ceiling (duration,
// fps, bitrate, dimensions). Lives in its own module for the one-class-per-
// file rule; re-exported from ffmpeg.ts so callers import from one place.
export class ResourceLimitError extends Error {
  override name = "ResourceLimitError";
}
