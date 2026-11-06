import { describe, expect, test } from "bun:test";

import {
  EXPECTED_ANDROID_PACKAGE,
  googleServicesCandidates,
  pickFirstExisting,
  validateGoogleServices,
} from "./google-services-lib";

function config(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    client: [
      {
        client_info: {
          android_client_info: { package_name: EXPECTED_ANDROID_PACKAGE },
        },
      },
    ],
    project_info: { project_id: "asocialmedia-61751" },
    ...overrides,
  });
}

describe("validateGoogleServices", () => {
  test("accepts the real config shape and reports identity", () => {
    const verdict = validateGoogleServices(config());
    expect(verdict.ok).toBe(true);
    expect(verdict.packageName).toBe(EXPECTED_ANDROID_PACKAGE);
    expect(verdict.projectId).toBe("asocialmedia-61751");
  });

  test("rejects malformed JSON", () => {
    const verdict = validateGoogleServices("not json");
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toBe("is not valid JSON");
  });

  test("rejects a non-object payload", () => {
    expect(validateGoogleServices("[]").ok).toBe(false);
    expect(validateGoogleServices("null").ok).toBe(false);
  });

  test("rejects a missing project_id", () => {
    const verdict = validateGoogleServices(JSON.stringify({ client: [] }));
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain("project_info.project_id");
  });

  test("rejects a config for a different package", () => {
    const verdict = validateGoogleServices(
      config({
        client: [
          {
            client_info: {
              android_client_info: { package_name: "com.example.other" },
            },
          },
        ],
      })
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain("com.example.other");
    expect(verdict.error).toContain(EXPECTED_ANDROID_PACKAGE);
  });

  test("rejects a config with no android client entry", () => {
    expect(
      validateGoogleServices(
        JSON.stringify({ client: [], project_info: { project_id: "x" } })
      ).ok
    ).toBe(false);
  });
});

describe("googleServicesCandidates", () => {
  const paths = {
    explicitPath: "/tmp/explicit.json",
    mobileFile: "/app/apps/mobile/google-services.json",
    rootFile: "/app/google-services.json",
  };

  test("orders explicit, then mobile, then root", () => {
    const candidates = googleServicesCandidates(paths);
    expect(candidates.map((c) => c.path)).toEqual([
      paths.explicitPath,
      paths.mobileFile,
      paths.rootFile,
    ]);
  });

  test("omits the explicit entry when unset", () => {
    const candidates = googleServicesCandidates({
      ...paths,
      explicitPath: null,
    });
    expect(candidates.map((c) => c.path)).toEqual([
      paths.mobileFile,
      paths.rootFile,
    ]);
  });
});

describe("pickFirstExisting", () => {
  // Two candidates: mobile, then root.
  const candidates = googleServicesCandidates({
    explicitPath: null,
    mobileFile: "mobile.json",
    rootFile: "root.json",
  });

  test("returns the first non-null content with its source", () => {
    const picked = pickFirstExisting(candidates, ["MOBILE", "ROOT"]);
    expect(picked).toEqual({
      content: "MOBILE",
      source: "apps/mobile/google-services.json",
    });
  });

  test("falls through to a later candidate", () => {
    const picked = pickFirstExisting(candidates, [null, "ROOT"]);
    expect(picked?.content).toBe("ROOT");
    expect(picked?.source).toContain("repo root");
  });

  test("returns null when none existed", () => {
    expect(pickFirstExisting(candidates, [null, null])).toBeNull();
  });

  test("treats empty string as present (a file existed)", () => {
    const picked = pickFirstExisting(candidates, ["", null]);
    expect(picked?.content).toBe("");
  });
});
