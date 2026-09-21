import { describe, expect, test } from "bun:test";

import {
  compareVersions,
  findLatestApkRelease,
  githubReleasesUrl,
  isTrustedApkUrl,
  isUpdateRequired,
  parseApkVersion,
  parseReleases,
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

  test("ignores prerelease APKs", () => {
    const found = findLatestApkRelease([
      {
        assets: [
          {
            browser_download_url: "https://x/rc.apk",
            name: "asocialmedia-v0.0.30.apk",
            size: 1,
          },
        ],
        prerelease: true,
        tag_name: "v1.6.1+rc",
      },
      {
        assets: [
          {
            browser_download_url: "https://x/stable.apk",
            name: "asocialmedia-v0.0.19.apk",
            size: 1,
          },
        ],
        prerelease: false,
        tag_name: "v1.6.0+stable",
      },
    ]);
    expect(found?.version).toBe("0.0.19");
  });

  test("returns null when only prereleases ship an APK", () => {
    expect(
      findLatestApkRelease([
        {
          assets: [
            {
              browser_download_url: "https://x/rc.apk",
              name: "asocialmedia-v0.0.30.apk",
              size: 1,
            },
          ],
          prerelease: true,
          tag_name: "v1.6.1+rc",
        },
      ])
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

describe("isTrustedApkUrl", () => {
  const repo = "asocialmedia/social";

  test("accepts this repo's https release asset", () => {
    expect(
      isTrustedApkUrl(
        "https://github.com/asocialmedia/social/releases/download/v1.0.0/app.apk",
        repo
      )
    ).toBe(true);
  });

  test("rejects cleartext, other hosts, and other repos", () => {
    expect(isTrustedApkUrl("http://github.com/a/b/releases/x", repo)).toBe(
      false
    );
    expect(
      isTrustedApkUrl("https://evil.example.com/asocialmedia/social/x", repo)
    ).toBe(false);
    expect(
      isTrustedApkUrl("https://github.com/other/repo/releases/x", repo)
    ).toBe(false);
  });

  test("rejects non-URL garbage", () => {
    expect(isTrustedApkUrl("not a url", repo)).toBe(false);
  });
});

describe("parseReleases", () => {
  test("drops malformed entries and assets", () => {
    const releases = parseReleases([
      null,
      "nope",
      { assets: "not-an-array", tag_name: "v1" },
      {
        assets: [
          { browser_download_url: 1, name: "x" },
          { browser_download_url: "https://x/a.apk", name: 2 },
          {
            browser_download_url: "https://x/a.apk",
            name: "asocialmedia-v0.0.1.apk",
            size: 5,
          },
        ],
        tag_name: "v2",
      },
    ]);
    expect(releases).toHaveLength(2);
    expect(releases[1]?.assets).toHaveLength(1);
    expect(releases[1]?.assets[0]?.size).toBe(5);
  });

  test("returns an empty list for a non-array payload", () => {
    expect(parseReleases({ message: "rate limited" })).toEqual([]);
  });
});
