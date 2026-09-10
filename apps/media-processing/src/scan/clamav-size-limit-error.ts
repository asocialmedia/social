// Raised when clamd answers INSTREAM size limit exceeded: the file exceeds
// the daemon's StreamMaxLength. A property of the FILE, not the scanner -
// callers reject the upload instead of retrying. Own module for the
// one-class-per-file rule; re-exported from clamav.ts.
export class ClamAvSizeLimitError extends Error {
  override name = "ClamAvSizeLimitError";
}
