import { describe, expect, test } from "bun:test";

import {
  isValidMultipartPartNumber,
  multipartPartBounds,
  multipartPartCount,
  MULTIPART_UPLOAD_PART_SIZE_BYTES,
  shouldUseMultipartUpload,
} from "./multipart-upload";

describe("large-media multipart upload planning", () => {
  test("uses multipart only above the direct-upload threshold", () => {
    expect(shouldUseMultipartUpload(64 * 1024 * 1024)).toBe(false);
    expect(shouldUseMultipartUpload(64 * 1024 * 1024 + 1)).toBe(true);
  });

  test("splits a large video into contiguous 16 MiB parts", () => {
    const fileSize = 80 * 1024 * 1024 + 17;

    expect(multipartPartCount(fileSize)).toBe(6);
    expect(multipartPartBounds(fileSize, 1)).toEqual({
      end: MULTIPART_UPLOAD_PART_SIZE_BYTES,
      start: 0,
    });
    expect(multipartPartBounds(fileSize, 6)).toEqual({
      end: fileSize,
      start: 5 * MULTIPART_UPLOAD_PART_SIZE_BYTES,
    });
  });

  test("rejects invalid and out-of-range part numbers", () => {
    const fileSize = 80 * 1024 * 1024;

    expect(isValidMultipartPartNumber(fileSize, 0)).toBe(false);
    expect(isValidMultipartPartNumber(fileSize, 6)).toBe(false);
    expect(multipartPartBounds(fileSize, 6)).toBeNull();
  });
});
