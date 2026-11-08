import { describe, expect, test } from "bun:test";

import {
  hasMobileAsset,
  reusePreviousMobileAssets,
  selectReleaseWithApk,
} from "./reuse-previous-mobile-assets";

describe("hasMobileAsset", () => {
  test("detects a release carrying an APK", () => {
    expect(
      hasMobileAsset({
        assets: [{ name: "asocialmedia-v0.2.57-arm64-v8a.apk" }],
        tagName: "v1.13.52+108e1eb",
      })
    ).toBe(true);
  });

  test("ignores checksum-only and unrelated assets", () => {
    expect(
      hasMobileAsset({
        assets: [{ name: "asocialmedia-v0.2.57.apk.sha256" }],
        tagName: "v1.13.52+108e1eb",
      })
    ).toBe(false);
    expect(hasMobileAsset({ assets: [], tagName: "v1.13.98+d037065" })).toBe(
      false
    );
  });
});

describe("selectReleaseWithApk", () => {
  test("picks the newest release carrying an APK", () => {
    const selected = selectReleaseWithApk([
      { assets: [], tagName: "v1.13.98+d037065" },
      {
        assets: [{ name: "asocialmedia-v0.2.57-arm64-v8a.apk" }],
        tagName: "v1.13.52+108e1eb",
      },
      {
        assets: [{ name: "asocialmedia-v0.2.50-arm64-v8a.apk" }],
        tagName: "v1.13.50+c290459",
      },
    ]);
    expect(selected?.tagName).toBe("v1.13.52+108e1eb");
  });

  test("returns null when no release carries an APK", () => {
    expect(
      selectReleaseWithApk([{ assets: [], tagName: "v1.13.98+d037065" }])
    ).toBeNull();
    expect(selectReleaseWithApk([])).toBeNull();
  });
});

test("reuse flow retries lookup and forwards download patterns and provenance", async () => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const root = await mkdtemp(path.join(tmpdir(), "asm-reuse-flow-"));
  const calls: string[][] = [];
  let viewCalls = 0;
  try {
    const envFile = path.join(root, "github-env");
    const dir = path.join(root, "artifacts");
    await reusePreviousMobileAssets({
      repoRoot: root,
      env: { ARTIFACT_DIR: "artifacts", GITHUB_ENV: envFile },
      wait: async () => {},
      logger: { log() {}, warn() {} },
      runGh: async (args) => {
        calls.push(args);
        if (args[1] === "list")
          return {
            stdout: JSON.stringify([{ tagName: "v1.2.3" }]),
            stderr: "",
            exitCode: 0,
          };
        if (args[1] === "view") {
          viewCalls += 1;
          if (viewCalls === 1)
            return { stdout: "", stderr: "HTTP 503", exitCode: 1 };
          return {
            stdout: JSON.stringify({
              assets: [{ name: "asocialmedia-v0.2.57-arm64-v8a.apk" }],
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "downloaded", stderr: "", exitCode: 0 };
      },
    });
    expect(viewCalls).toBe(2);
    expect(calls[0]).toEqual([
      "release",
      "list",
      "--limit",
      "50",
      "--json",
      "tagName",
    ]);
    expect(calls[1]).toEqual(["release", "view", "v1.2.3", "--json", "assets"]);
    expect(calls.at(-1)).toEqual([
      "release",
      "download",
      "v1.2.3",
      "--pattern",
      "asocialmedia-*.apk",
      "--pattern",
      "asocialmedia-*.aab",
      "--pattern",
      "asocialmedia-*.apk.sha256",
      "--pattern",
      "asocialmedia-*.aab.sha256",
      "--dir",
      dir,
      "--clobber",
    ]);
    expect(await readFile(envFile, "utf8")).toBe("REUSED_APK_TAG=v1.2.3\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exhausted metadata lookups warn and allow a release without reused assets", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const root = await mkdtemp(path.join(tmpdir(), "asm-reuse-outage-"));
  let calls = 0;
  const warnings: string[] = [];
  try {
    await reusePreviousMobileAssets({
      repoRoot: root,
      env: {},
      wait: async () => {},
      logger: {
        log() {},
        warn: (message) => {
          warnings.push(message);
        },
      },
      runGh: async () => {
        calls += 1;
        return { stdout: "", stderr: "HTTP 502", exitCode: 1 };
      },
    });
    expect(calls).toBe(3);
    expect(warnings.join(" ")).toContain("publishing without reused assets");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
