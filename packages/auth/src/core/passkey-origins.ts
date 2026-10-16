// WebAuthn origins the passkey plugin must accept.
//
// A browser signs the ceremony with the page origin (https://asocialmedia.cc).
// An Android app signs it with `android:apk-key-hash:<base64url sha256 of the
// signing certificate>` instead, one value per certificate the APK may be
// signed with, so the server has to list them explicitly or every native
// passkey request fails origin validation.

const ANDROID_PREFIX = "android:apk-key-hash:";
const HEX_FINGERPRINT = /^[0-9a-f]{2}(?::[0-9a-f]{2}){31}$/i;
// The release certificate published in the site's Digital Asset Links file.
const RELEASE_ANDROID_ORIGIN =
  "android:apk-key-hash:iMI4-LlXDxeSKHD6lDjDeAMJTmyobTa7C95nrGPwBxk";

// Converts a keytool SHA-256 fingerprint into the base64url WebAuthn origin digest.
export function apkKeyHashFromFingerprint(fingerprint: string): string {
  const normalized = fingerprint.trim();
  if (!HEX_FINGERPRINT.test(normalized)) {
    throw new Error("Expected a colon-separated SHA-256 fingerprint");
  }
  const bytes = Buffer.from(normalized.replaceAll(":", ""), "hex");
  return bytes.toString("base64url");
}

// Parses configured digests, fingerprints, or full Android origins; ignores blanks.
export function parseAndroidApkKeyHashes(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (entry.startsWith(ANDROID_PREFIX)) {
        return entry;
      }
      if (HEX_FINGERPRINT.test(entry)) {
        return `${ANDROID_PREFIX}${apkKeyHashFromFingerprint(entry)}`;
      }
      return `${ANDROID_PREFIX}${entry}`;
    });
}

// Browser origin first, followed by the app's release certificate and configured certificates.
export function buildPasskeyOrigins(
  webOrigin: string,
  androidApkKeyHashes?: string
): string[] {
  const releaseOrigins =
    webOrigin === "https://asocialmedia.cc" ? [RELEASE_ANDROID_ORIGIN] : [];
  return [
    ...new Set([
      webOrigin,
      ...releaseOrigins,
      ...parseAndroidApkKeyHashes(androidApkKeyHashes),
    ]),
  ];
}
