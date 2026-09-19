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
  tag_name: string;
}

export function githubReleasesUrl(repo: string, perPage = 10): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`;
}

export function parseApkVersion(assetName: string): string | null {
  return APK_NAME_REGEX.exec(assetName)?.groups?.version ?? null;
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

// Latest release (in API order) that actually ships an APK. Releases built
// without mobile changes carry no APK, so the newest tag is not enough.
export function findLatestApkRelease(
  releases: UpdateRelease[]
): ApkRelease | null {
  for (const release of releases) {
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
