// The ABI split, as data, so the Gradle injection and the release build script
// cannot disagree about which APKs a release produces.
//
// The React Native native layer is the single largest thing in the Android
// build: lib/ measured 84.4 MB uncompressed across the four ABIs declared in
// gradle.properties, of which x86 (23.4 MB) and x86_64 (23.6 MB) are 47 MB that
// no real Android device can ever load. They exist only so the emulator can
// run, so shipping them inside a release APK makes every user download
// emulator-only code. An ABI split gives each APK exactly one ABI, so an arm64
// device downloads ~50 MB instead of ~112 MB.
//
// The x86_64 split is the one to `adb install` for emulator runs, so local
// development is unaffected. Google Play performs the equivalent split
// automatically from an AAB, so `bundleRelease` remains the right artifact for
// store distribution.

// Order is the order the Gradle `include` list is written in.
export const ANDROID_SPLIT_ABIS = [
  "armeabi-v7a",
  "arm64-v8a",
  "x86",
  "x86_64",
] as const;

export type AndroidSplitAbi = (typeof ANDROID_SPLIT_ABIS)[number];

/**
 * Whether a build is asking for an ABI the split actually produces. Gradle
 * would silently skip a split it does not know, so an unrecognised ABI has to
 * fail before a multi-minute build rather than after it.
 */
export function isAndroidSplitAbi(value: string): value is AndroidSplitAbi {
  return (ANDROID_SPLIT_ABIS as readonly string[]).includes(value);
}

/**
 * Where Gradle writes one ABI's release APK once the split is enabled. With
 * `universalApk false` there is no plain `app-release.apk` to fall back on: the
 * per-ABI file name is the only artifact the build produces.
 */
export function splitApkFileName(abi: string): string {
  return `app-${abi}-release.apk`;
}
