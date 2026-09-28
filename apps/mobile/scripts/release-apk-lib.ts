// Choosing which release APK to verify and package, with no filesystem access
// so the decision is unit-testable.
//
// The app ships an ABI split (see ../plugins/abi-splits), so `assembleRelease`
// writes one APK per ABI into android/app/build/outputs/apk/release and, with
// `universalApk false`, no `app-release.apk` at all. A script that still looks
// for the universal name fails after a successful - and expensive - Gradle
// build, before it can verify a signature or publish anything.

import { splitApkFileName } from "../plugins/abi-splits";

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
