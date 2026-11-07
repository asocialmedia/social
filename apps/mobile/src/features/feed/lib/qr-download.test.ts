import { describe, expect, test } from "bun:test";

import { decodeBase64ToBytes } from "./qr-download";

describe("decodeBase64ToBytes", () => {
  test("decodes a known payload", () => {
    // "Hello" in base64.
    expect([...decodeBase64ToBytes("SGVsbG8=")]).toEqual([
      72, 101, 108, 108, 111,
    ]);
  });

  test("round-trips through the platform encoder", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const encoded = Buffer.from(bytes).toString("base64");
    expect(decodeBase64ToBytes(encoded)).toEqual(bytes);
  });

  test("rejects invalid input", () => {
    expect(() => decodeBase64ToBytes("!!!")).toThrow("Invalid base64 input");
  });
});
