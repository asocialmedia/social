import { describe, expect, test } from "bun:test";

import {
  apkKeyHashFromFingerprint,
  buildPasskeyOrigins,
  parseAndroidApkKeyHashes,
} from "./passkey-origins";

// Release signing cert as published in apps/web/public/.well-known/assetlinks.json.
const RELEASE_FINGERPRINT =
  "88:C2:38:F8:B9:57:0F:17:92:28:70:FA:94:38:C3:78:03:09:4E:6C:A8:6D:36:BB:0B:DE:67:AC:63:F0:07:19";
const RELEASE_HASH = "iMI4-LlXDxeSKHD6lDjDeAMJTmyobTa7C95nrGPwBxk";

describe("apkKeyHashFromFingerprint", () => {
  test("encodes a keytool fingerprint as base64url", () => {
    expect(apkKeyHashFromFingerprint(RELEASE_FINGERPRINT)).toBe(RELEASE_HASH);
  });

  test("rejects anything that is not a SHA-256 fingerprint", () => {
    expect(() => apkKeyHashFromFingerprint("AA:BB")).toThrow();
  });
});

describe("parseAndroidApkKeyHashes", () => {
  test("accepts digests, fingerprints and full origins", () => {
    expect(
      parseAndroidApkKeyHashes(
        ` ${RELEASE_HASH}, ${RELEASE_FINGERPRINT} ,android:apk-key-hash:abc,,`
      )
    ).toEqual([
      `android:apk-key-hash:${RELEASE_HASH}`,
      `android:apk-key-hash:${RELEASE_HASH}`,
      "android:apk-key-hash:abc",
    ]);
  });

  test("is empty when unset", () => {
    expect(parseAndroidApkKeyHashes()).toEqual([]);
    expect(parseAndroidApkKeyHashes("")).toEqual([]);
  });
});

describe("buildPasskeyOrigins", () => {
  test("keeps the web origin first", () => {
    expect(
      buildPasskeyOrigins("https://asocialmedia.cc", RELEASE_HASH)
    ).toEqual([
      "https://asocialmedia.cc",
      `android:apk-key-hash:${RELEASE_HASH}`,
    ]);
    expect(buildPasskeyOrigins("http://localhost:3000")).toEqual([
      "http://localhost:3000",
    ]);
  });
});
