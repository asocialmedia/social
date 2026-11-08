import { describe, expect, test } from "bun:test";

import {
  hasMobileAsset,
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
