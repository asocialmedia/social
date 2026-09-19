import { describe, expect, test } from "bun:test";

import {
  compareVersions,
  findLatestApkRelease,
  githubReleasesUrl,
  isUpdateRequired,
  parseApkVersion,
} from "./update-check";

describe("parseApkVersion", () => {
  test("parses the mobile version from the asset name", () => {
    expect(parseApkVersion("asocialmedia-v0.0.19.apk")).toBe("0.0.19");
  });

  test("rejects sha files and unrelated assets", () => {
    expect(parseApkVersion("asocialmedia-v0.0.19.apk.sha256")).toBeNull();
    expect(parseApkVersion("app-release.apk")).toBeNull();
  });
});

describe("compareVersions", () => {
  test("orders semver numerically, not lexicographically", () => {
    expect(compareVersions("0.0.9", "0.0.19")).toBeLessThan(0);
    expect(compareVersions("0.0.19", "0.0.19")).toBe(0);
    expect(compareVersions("0.1.0", "0.0.99")).toBeGreaterThan(0);
  });
});

describe("findLatestApkRelease", () => {
  test("skips releases without an APK (mobile unchanged)", () => {
    const found = findLatestApkRelease([
      { assets: [], tag_name: "v1.6.0+aaa" },
      {
        assets: [
          {
            browser_download_url: "https://x/y.apk",
            name: "asocialmedia-v0.0.18.apk",
            size: 1,
          },
        ],
        tag_name: "v1.5.9+bbb",
      },
    ]);
    expect(found?.version).toBe("0.0.18");
    expect(found?.release.tag_name).toBe("v1.5.9+bbb");
  });

  test("returns null when no release ships an APK", () => {
    expect(
      findLatestApkRelease([{ assets: [], tag_name: "v1.6.0+aaa" }])
    ).toBeNull();
  });
});

describe("isUpdateRequired", () => {
  test("requires update only when the APK is newer", () => {
    expect(isUpdateRequired("0.0.19", "0.0.20")).toBe(true);
    expect(isUpdateRequired("0.0.19", "0.0.19")).toBe(false);
    expect(isUpdateRequired("0.0.20", "0.0.19")).toBe(false);
  });

  test("never blocks when the current version is unknown", () => {
    expect(isUpdateRequired(null, "9.9.9")).toBe(false);
  });
});

describe("githubReleasesUrl", () => {
  test("targets the repo releases API", () => {
    expect(githubReleasesUrl("asocialmedia/social")).toBe(
      "https://api.github.com/repos/asocialmedia/social/releases?per_page=10"
    );
  });
});
