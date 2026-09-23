import { describe, expect, test } from "bun:test";

import { urlBase64ToUint8Array } from "./client";

describe("urlBase64ToUint8Array", () => {
  test("decodes a standard base64url VAPID key", () => {
    // "hello" -> aGVsbG8
    const decoded = urlBase64ToUint8Array("aGVsbG8");
    expect(String.fromCodePoint(...decoded)).toBe("hello");
  });

  test("handles the - and _ substitutions and missing padding", () => {
    // 0xfb 0xff encodes to "-_8" in base64url (unpadded).
    const decoded = urlBase64ToUint8Array("-_8");
    expect([...decoded]).toEqual([251, 255]);
  });

  test("returns an ArrayBuffer-backed view of the right length", () => {
    const decoded = urlBase64ToUint8Array("aGVsbG8");
    expect(decoded.byteLength).toBe(5);
    expect(decoded.buffer).toBeInstanceOf(ArrayBuffer);
  });
});
