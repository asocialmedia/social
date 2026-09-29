// Pure support-floor logic for the native build. No React Native imports, so it
// can be unit tested directly.
//
// The question is deliberately "is this build still supported", never "is there
// something newer": a build one version behind the newest release is perfectly
// fine, and a client that blocked on that would nag every user who has not
// opened the store in a week. Only an explicit floor - raised when a release
// actually breaks older builds - retires a build.

export interface SupportPolicy {
  /** The oldest build the server still serves. null = every build is supported. */
  minimumSupported: string | null;
}

export type SupportVerdict =
  // A floor is configured and this build is older than it.
  | "unsupported"
  // A floor is configured and this build is at or above it.
  | "supported"
  // No floor is configured, so nothing can retire a build.
  | "no-policy"
  // The build's own version could not be read, which is not evidence of anything.
  | "unknown-version";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * A strict semver, or null. Refusing anything else is deliberate: a floor of
 * "0.1" or "latest" would compare as garbage, and an unparseable answer must
 * never be the thing that blocks a user's app.
 */
export function parseVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return SEMVER_PATTERN.test(trimmed) ? trimmed : null;
}

/** Numeric semver compare: negative when a < b, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((part) => Number(part) || 0);
  const partsB = b.split(".").map((part) => Number(part) || 0);
  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function evaluateSupport(
  currentVersion: unknown,
  policy: SupportPolicy
): SupportVerdict {
  const floor = parseVersion(policy.minimumSupported);
  // An unparseable floor is treated as no floor at all. A typo in a server
  // variable must not be able to lock out every installed copy of the app.
  if (!floor) {
    return "no-policy";
  }
  const current = parseVersion(currentVersion);
  if (!current) {
    return "unknown-version";
  }
  return compareVersions(current, floor) < 0 ? "unsupported" : "supported";
}
