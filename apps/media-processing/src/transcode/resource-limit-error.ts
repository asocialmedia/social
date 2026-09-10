// Raised when a probed stream exceeds a decoder safety ceiling (duration,
// fps, bitrate, dimensions). Lives in its own module for the one-class-per-
// file rule; re-exported from ffmpeg.ts so callers import from one place.
//
// Extends BullMQ's UnrecoverableError so a policy rejection is terminal on
// the first attempt: the file is malformed-by-policy, not transiently
// broken, so burning the remaining attempts (with backoff) on a verdict
// that cannot change only delays the failure marking. The `name` stays
// "ResourceLimitError", which the worker's failed-handler keys on to record
// the rejection on the media row.
import { UnrecoverableError } from "bullmq";

export class ResourceLimitError extends UnrecoverableError {
  override name = "ResourceLimitError";
}
