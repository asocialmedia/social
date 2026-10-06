// Choosing which release APK to verify and package, with no filesystem access
// so the decision is unit-testable.
//
// The app ships an ABI split (see ../plugins/with-android-abi-splits), so
// `assembleRelease` writes one APK per ABI into
// android/app/build/outputs/apk/release and, with `universalApk false`, no
// `app-release.apk` at all. A script that still looks for the universal name
// fails after a successful - and expensive - Gradle build, before it can verify
// a signature or publish anything.

import {
  SHIPPING_ABI,
  splitApkFileName,
} from "../plugins/with-android-abi-splits";

/**
 * The published artifact name, carrying the ABI it was built for.
 *
 * A split APK is not universal: it installs only where the device's primary ABI
 * matches. Leaving the ABI out of the filename is what made an emulator-only
 * build indistinguishable from a shipping one, so a name like
 * `asocialmedia-latest.apk` got installed on an x86_64 emulator and crashed on
 * startup with no hint that the artifact was the wrong architecture.
 */
export function releaseApkArtifactName({
  abi,
  version,
}: {
  abi: string;
  version: string;
}): string {
  return `asocialmedia-v${version}-${abi}.apk`;
}

/**
 * Whether this build's APK may back the stable `asocialmedia-latest.apk`
 * download link.
 *
 * Only the shipping ABI qualifies. That link is what the README publishes, so
 * letting an emulator or legacy build claim it would replace a working
 * download with an APK that no phone can load.
 */
export function publishesLatestAlias(abi: string): boolean {
  return abi === SHIPPING_ABI;
}

/** One line naming the artifact and the devices it can actually start on. */
export function describeApkTarget(abi: string): string {
  const device = publishesLatestAlias(abi)
    ? "physical Android devices (this is the published download)"
    : "emulators only - no physical device loads this architecture";
  return `ABI ${abi}: ${device}.`;
}

export type ReleaseApkResolution =
  | { fileName: string; kind: "found" }
  | { expected: string; files: string[]; kind: "missing" };

/**
 * Picks the APK for one ABI out of the release output directory.
 *
 * Only that ABI's split is accepted. A universal `app-release.apk` sitting
 * next to the splits would mean the split is not in effect, and quietly
 * packaging it would ship the 112 MB artifact the split exists to eliminate -
 * so it is reported as missing rather than used as a fallback.
 */
export function resolveReleaseApk({
  abi,
  files,
}: {
  abi: string;
  files: readonly string[];
}): ReleaseApkResolution {
  const expected = splitApkFileName(abi);
  const available = files.filter((file) => file.endsWith(".apk")).toSorted();
  return available.includes(expected)
    ? { fileName: expected, kind: "found" }
    : { expected, files: available, kind: "missing" };
}

/** One line explaining what a `missing` resolution actually means. */
export function describeMissingReleaseApk(
  missing: Extract<ReleaseApkResolution, { kind: "missing" }>,
  outputsDir: string
): string {
  const found =
    missing.files.length > 0 ? missing.files.join(", ") : "no APK files at all";
  return (
    `Expected ${missing.expected} in ${outputsDir}, found ${found}. ` +
    "The release build is split per ABI, so the requested ABI has to be one the split produces."
  );
}
