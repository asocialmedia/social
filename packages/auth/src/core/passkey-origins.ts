// WebAuthn origins the passkey plugin must accept.
//
// A browser signs the ceremony with the page origin (https://asocialmedia.cc).
// An Android app signs it with `android:apk-key-hash:<base64url sha256 of the
// signing certificate>` instead, one value per certificate the APK may be
// signed with, so the server has to list them explicitly or every native
// passkey request fails origin validation.

const ANDROID_PREFIX = "android:apk-key-hash:";
const HEX_FINGERPRINT = /^[0-9a-f]{2}(?::[0-9a-f]{2}){31}$/i;

/**
 * Converts an Android signing-cert SHA-256 fingerprint as printed by keytool
 * ("AA:BB:...") into the base64url digest WebAuthn expects in the origin.
 */
export function apkKeyHashFromFingerprint(fingerprint: string): string {
  const normalized = fingerprint.trim();
  if (!HEX_FINGERPRINT.test(normalized)) {
    throw new Error("Expected a colon-separated SHA-256 fingerprint");
  }
  const bytes = Buffer.from(normalized.replaceAll(":", ""), "hex");
  return bytes.toString("base64url");
}

/**
 * Parses PASSKEY_ANDROID_APK_KEY_HASHES: a comma-separated list where each
 * entry is a base64url digest, a keytool fingerprint, or a full
 * `android:apk-key-hash:` origin. Blank entries are ignored.
 */
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

/** Browser origin first, then every configured Android app origin. */
export function buildPasskeyOrigins(
  webOrigin: string,
  androidApkKeyHashes?: string
): string[] {
  return [webOrigin, ...parseAndroidApkKeyHashes(androidApkKeyHashes)];
}
