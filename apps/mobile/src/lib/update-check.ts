// Pure force-update logic (no React Native imports, unit tested).
// Release tags track the ROOT version (v<root>+<sha>), so the client must
// compare the APK asset name (asocialmedia-v<mobile>.apk), never the tag.

export const GITHUB_REPO_DEFAULT = "asocialmedia/social";
export const APK_ASSET_SUFFIX = ".apk";

const APK_NAME_REGEX = /^asocialmedia-v(?<version>\d+\.\d+\.\d+)\.apk$/;

export interface UpdateAsset {
  browser_download_url: string;
  name: string;
  size: number;
}

export interface UpdateRelease {
  assets: UpdateAsset[];
  // Test/preview tags are published as prereleases; they must never be chosen
  // as a forced update target.
  prerelease?: boolean;
  tag_name: string;
}

export function githubReleasesUrl(repo: string, perPage = 10): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`;
}

export function parseApkVersion(assetName: string): string | null {
  return APK_NAME_REGEX.exec(assetName)?.groups?.version ?? null;
}

// Release assets are served from github.com. Accept only an https URL under
// THIS repo's releases path, so a malformed or hostile API response can never
// aim the installer at an arbitrary APK.
export function isTrustedApkUrl(url: string, repo: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.hostname !== "github.com") {
    return false;
  }
  return parsed.pathname.startsWith(`/${repo}/releases/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Validates the GitHub releases payload before anything downstream reads it.
// Unknown/malformed entries are dropped rather than trusted, so a shape change
// or an error body can never crash the gate or be mistaken for a real release.
export function parseReleases(payload: unknown): UpdateRelease[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const releases: UpdateRelease[] = [];
  for (const entry of payload) {
    if (!isRecord(entry)) {
      continue;
    }
    const assets: UpdateAsset[] = [];
    if (Array.isArray(entry.assets)) {
      for (const asset of entry.assets) {
        if (!isRecord(asset)) {
          continue;
        }
        const { browser_download_url: url, name, size } = asset;
        if (typeof url !== "string" || typeof name !== "string") {
          continue;
        }
        assets.push({
          browser_download_url: url,
          name,
          size: typeof size === "number" ? size : 0,
        });
      }
    }
    releases.push({
      assets,
      prerelease: entry.prerelease === true,
      tag_name: typeof entry.tag_name === "string" ? entry.tag_name : "",
    });
  }
  return releases;
}

// Numeric semver compare: negative when a < b, positive when a > b.
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

export interface ApkRelease {
  asset: UpdateAsset;
  release: UpdateRelease;
  version: string;
}

// Latest production release (in API order) that actually ships an APK.
// Releases built without mobile changes carry no APK, so the newest tag is not
// enough, and a prerelease must never be offered as a mandatory update.
export function findLatestApkRelease(
  releases: UpdateRelease[]
): ApkRelease | null {
  for (const release of releases) {
    if (release.prerelease) {
      continue;
    }
    for (const asset of release.assets) {
      const version = parseApkVersion(asset.name);
      if (version) {
        return { asset, release, version };
      }
    }
  }
  return null;
}

export function isUpdateRequired(
  currentVersion: string | null,
  apkVersion: string
): boolean {
  if (!currentVersion) {
    return false;
  }
  return compareVersions(apkVersion, currentVersion) > 0;
}
