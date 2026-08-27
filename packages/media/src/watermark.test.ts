import { describe, expect, test } from "bun:test";

import {
  buildWatermarkPattern,
  buildWatermarkPayload,
  crc16Ccitt,
  hashUserId,
} from "./watermark";

describe("watermark payload", () => {
  test("hashUserId is deterministic and peppered", () => {
    const a = hashUserId("user-123", "pepper-xyz-1234567890");
    const b = hashUserId("user-123", "pepper-xyz-1234567890");
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
  });

  test("different users produce different hashes", () => {
    const a = hashUserId("user-1", "pepper");
    const b = hashUserId("user-2", "pepper");
    expect(a).not.toBe(b);
  });

  test("null userId returns null", () => {
    expect(hashUserId(null, "pepper")).toBeNull();
  });

  test("different peppers produce different hashes", () => {
    const a = hashUserId("user-1", "pepper-a-12345678");
    const b = hashUserId("user-1", "pepper-b-12345678");
    expect(a).not.toBe(b);
  });

  test("buildWatermarkPayload carries version 1", () => {
    const payload = buildWatermarkPayload("media-123", "abc123def456");
    expect(payload.mediaId).toBe("media-123");
    expect(payload.hashedUploaderId).toBe("abc123def456");
    expect(payload.version).toBe(1);
  });

  test("buildWatermarkPattern is deterministic", () => {
    const payload = buildWatermarkPayload("m1", "h1");
    const a = buildWatermarkPattern(payload, 32, 32);
    const b = buildWatermarkPattern(payload, 32, 32);
    expect(a).toEqual(b);
  });

  test("different payloads produce different patterns", () => {
    const a = buildWatermarkPattern(buildWatermarkPayload("m1", "h1"), 16, 16);
    const b = buildWatermarkPattern(buildWatermarkPayload("m2", "h1"), 16, 16);
    // At least one bit differs
    let diff = 0;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) {
        diff += 1;
      }
    }
    expect(diff).toBeGreaterThan(0);
  });

  test("pattern size matches image dimensions", () => {
    const pattern = buildWatermarkPattern(
      buildWatermarkPayload("m1", null),
      10,
      20
    );
    expect(pattern.length).toBe(200);
  });

  test("crc16Ccitt is non-trivial and deterministic", () => {
    const a = crc16Ccitt(new TextEncoder().encode("hello"));
    const b = crc16Ccitt(new TextEncoder().encode("hello"));
    const c = crc16Ccitt(new TextEncoder().encode("world"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
