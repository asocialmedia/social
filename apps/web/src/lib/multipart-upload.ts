// The browser sends each large-media part directly to object storage. Keeping
// every part below common CDN request ceilings prevents a proxied storage host
// from rejecting an otherwise permitted video as one oversized PUT.

export const MULTIPART_UPLOAD_THRESHOLD_BYTES = 64 * 1024 * 1024;
export const MULTIPART_UPLOAD_PART_SIZE_BYTES = 16 * 1024 * 1024;

export function shouldUseMultipartUpload(fileSize: number): boolean {
  return fileSize > MULTIPART_UPLOAD_THRESHOLD_BYTES;
}

export function multipartPartCount(fileSize: number): number {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    return 0;
  }
  return Math.ceil(fileSize / MULTIPART_UPLOAD_PART_SIZE_BYTES);
}

export function isValidMultipartPartNumber(
  fileSize: number,
  partNumber: number
): boolean {
  return (
    Number.isSafeInteger(partNumber) &&
    partNumber >= 1 &&
    partNumber <= multipartPartCount(fileSize)
  );
}

export function multipartPartBounds(
  fileSize: number,
  partNumber: number
): { end: number; start: number } | null {
  if (!isValidMultipartPartNumber(fileSize, partNumber)) {
    return null;
  }
  const start = (partNumber - 1) * MULTIPART_UPLOAD_PART_SIZE_BYTES;
  return {
    end: Math.min(start + MULTIPART_UPLOAD_PART_SIZE_BYTES, fileSize),
    start,
  };
}
