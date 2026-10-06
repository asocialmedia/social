import { describe, expect, it } from "bun:test";

import {
  ANDROID_SPLIT_ABIS,
  SHIPPING_ABI,
} from "../plugins/with-android-abi-splits";
import {
  describeApkTarget,
  describeMissingReleaseApk,
  publishesLatestAlias,
  releaseApkArtifactName,
  resolveReleaseApk,
} from "./release-apk-lib";

// A regression here means the release step fails after a successful Gradle
// build, or worse, packages an APK carrying emulator-only native code.
describe("resolveReleaseApk", () => {
  it("picks the requested ABI's split out of the release output", () => {
    const files = [
      ...ANDROID_SPLIT_ABIS.map((abi) => `app-${abi}-release.apk`),
      "output-metadata.json",
    ];

    expect(resolveReleaseApk({ abi: "arm64-v8a", files })).toEqual({
      fileName: "app-arm64-v8a-release.apk",
      kind: "found",
    });
    expect(resolveReleaseApk({ abi: "x86_64", files })).toEqual({
      fileName: "app-x86_64-release.apk",
      kind: "found",
    });
  });

  it("never falls back to a universal APK", () => {
    // universalApk false means the split produced no app-release.apk. If one is
    // there anyway the split is not in effect, and shipping it would put every
    // ABI back into one download.
    const resolution = resolveReleaseApk({
      abi: "arm64-v8a",
      files: ["app-release.apk"],
    });
    expect(resolution.kind).toBe("missing");
  });

  it("reports what it did find when the ABI is missing", () => {
    const resolution = resolveReleaseApk({
      abi: "armeabi-v7a",
      files: ["app-arm64-v8a-release.apk", "output-metadata.json"],
    });
    expect(resolution).toEqual({
      expected: "app-armeabi-v7a-release.apk",
      files: ["app-arm64-v8a-release.apk"],
      kind: "missing",
    });
  });

  it("treats a missing output directory as an empty one", () => {
    expect(resolveReleaseApk({ abi: "arm64-v8a", files: [] })).toEqual({
      expected: "app-arm64-v8a-release.apk",
      files: [],
      kind: "missing",
    });
  });
});

describe("describeMissingReleaseApk", () => {
  it("names the expected file, the directory and what was there", () => {
    const message = describeMissingReleaseApk(
      {
        expected: "app-arm64-v8a-release.apk",
        files: ["app-x86-release.apk"],
        kind: "missing",
      },
      "/tmp/outputs"
    );
    expect(message).toContain("app-arm64-v8a-release.apk");
    expect(message).toContain("/tmp/outputs");
    expect(message).toContain("app-x86-release.apk");
  });

  it("says so plainly when the build produced no APKs at all", () => {
    const message = describeMissingReleaseApk(
      { expected: "app-arm64-v8a-release.apk", files: [], kind: "missing" },
      "/tmp/outputs"
    );
    expect(message).toContain("no APK files at all");
  });
});

// The regression these guard: an emulator-only APK was published under an
// architecture-less name, so it could be installed as the shipping artifact and
// crashed on startup with "couldn't find DSO to load: libreactnative.so".
describe("releaseApkArtifactName", () => {
  it("puts the ABI in the artifact name", () => {
    expect(releaseApkArtifactName({ abi: "x86_64", version: "0.1.41" })).toBe(
      "asocialmedia-v0.1.41-x86_64.apk"
    );
    expect(
      releaseApkArtifactName({ abi: "arm64-v8a", version: "0.1.41" })
    ).toBe("asocialmedia-v0.1.41-arm64-v8a.apk");
  });

  it("never produces the unversioned public name", () => {
    // That name is the public download; an artifact must not shadow it.
    const name = releaseApkArtifactName({
      abi: SHIPPING_ABI,
      version: "9.9.9",
    });
    expect(name).not.toBe("asocialmedia-latest.apk");
  });

  it("distinguishes artifacts that differ only by ABI", () => {
    expect(
      releaseApkArtifactName({ abi: "x86_64", version: "1.0.0" })
    ).not.toBe(releaseApkArtifactName({ abi: "arm64-v8a", version: "1.0.0" }));
  });
});

describe("publishesLatestAlias", () => {
  it("allows the shipping ABI only", () => {
    expect(publishesLatestAlias(SHIPPING_ABI)).toBe(true);
  });

  it("refuses emulator and legacy ABIs", () => {
    for (const abi of ["x86", "x86_64", "armeabi-v7a"]) {
      expect(publishesLatestAlias(abi)).toBe(false);
    }
  });
});

describe("describeApkTarget", () => {
  it("names the ABI and what it can run on", () => {
    expect(describeApkTarget("x86_64")).toContain("x86_64");
    expect(describeApkTarget("x86_64")).toContain("emulators only");
  });

  it("marks the shipping ABI as the published download", () => {
    expect(describeApkTarget(SHIPPING_ABI)).toContain("published download");
  });
});
