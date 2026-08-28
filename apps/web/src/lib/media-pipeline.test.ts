import { describe, expect, test } from "bun:test";

import {
  mediaTypeFromMime,
  sanitizeDisplayName,
  UploadPolicyError,
} from "./upload-policy";

// Security behavior of the upload policy gate. The declared MIME and filename
// are attacker-controlled; these checks are the first server-side line.

describe("mediaTypeFromMime", () => {
  test("families map to pipeline types", () => {
    expect(mediaTypeFromMime("image/png")).toBe("IMAGE");
    expect(mediaTypeFromMime("video/mp4")).toBe("VIDEO");
    expect(mediaTypeFromMime("video/quicktime")).toBe("VIDEO");
    expect(mediaTypeFromMime("audio/mpeg")).toBe("AUDIO");
  });

  test("executable/script payloads are rejected outright", () => {
    // SVG carries script execution risk from our origin.
    expect(() => mediaTypeFromMime("image/svg+xml")).toThrow(UploadPolicyError);
    for (const mime of [
      "text/html",
      "text/javascript",
      "application/javascript",
    ]) {
      expect(() => mediaTypeFromMime(mime)).toThrow(UploadPolicyError);
    }
  });

  test("non-media families never become uploads", () => {
    for (const mime of [
      "application/pdf",
      "application/zip",
      "application/x-httpd-php",
      "",
      "weird",
    ]) {
      expect(() => mediaTypeFromMime(mime)).toThrow(UploadPolicyError);
    }
  });
});

describe("sanitizeDisplayName", () => {
  test("strips path components from user filenames", () => {
    expect(sanitizeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayName("..\\..\\win\\system32\\evil.png")).toBe(
      "evil.png"
    );
  });

  test("neutralizes control chars and caps length", () => {
    const hostile = "report\u0000.png";
    expect(sanitizeDisplayName(hostile)).not.toContain("\u0000");
    const long = `${"a".repeat(500)}.png`;
    expect(sanitizeDisplayName(long).length).toBeLessThanOrEqual(120);
  });

  test("empty results fall back to a safe constant", () => {
    expect(sanitizeDisplayName("///")).toBe("file");
    expect(sanitizeDisplayName("")).toBe("file");
  });
});
