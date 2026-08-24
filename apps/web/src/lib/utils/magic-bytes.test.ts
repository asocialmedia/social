import { describe, expect, test } from "bun:test";

import { sniffFileSignature } from "./magic-bytes";

// Minimal but real magic-byte headers for each supported family.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const GIF = Buffer.from(Buffer.from("GIF89a", "latin1"));
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "latin1"),
]);
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom", "latin1")]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const SHELL = Buffer.from("#!/bin/sh\nrm -rf /\n");

describe("sniffFileSignature", () => {
  test("accepts matching image signatures", () => {
    expect(sniffFileSignature(JPEG, "image/jpeg").ok).toBe(true);
    expect(sniffFileSignature(PNG, "image/png").ok).toBe(true);
    expect(sniffFileSignature(GIF, "image/gif").ok).toBe(true);
    expect(sniffFileSignature(WEBP, "image/webp").ok).toBe(true);
    expect(sniffFileSignature(MP4, "image/heic").ok).toBe(true);
  });

  test("rejects non-image bytes declared as images", () => {
    const result = sniffFileSignature(SHELL, "image/png");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("image");
  });

  test("rejects image bytes declared as a different family", () => {
    expect(sniffFileSignature(PNG, "video/mp4").ok).toBe(false);
  });

  // SVG and PDF have no support at any level (uploads are rejected by the
  // mime allowlist before sniffing ever runs), so the sniffer no longer
  // carries special cases for them - their declared mimes fall through to
  // the lenient unknown-type path.

  test("validates video containers", () => {
    expect(sniffFileSignature(MP4, "video/mp4").ok).toBe(true);
    expect(sniffFileSignature(WEBM, "video/webm").ok).toBe(true);
    expect(sniffFileSignature(WEBM, "video/x-matroska").ok).toBe(true);
    expect(sniffFileSignature(JPEG, "video/mp4").ok).toBe(false);
  });

  test("validates office containers", () => {
    expect(
      sniffFileSignature(
        ZIP,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ).ok
    ).toBe(true);
  });

  test("is lenient for text/code and unknown types", () => {
    expect(sniffFileSignature(SHELL, "text/x-python").ok).toBe(true);
    expect(
      sniffFileSignature(Buffer.from("hello"), "application/octet-stream").ok
    ).toBe(true);
  });

  test("handles empty buffers without throwing", () => {
    expect(sniffFileSignature(Buffer.alloc(0), "image/png").ok).toBe(false);
    expect(sniffFileSignature(Buffer.alloc(0), "text/plain").ok).toBe(true);
  });
});
