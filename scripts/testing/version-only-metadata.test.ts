import { expect, test } from "bun:test";

import { selectAffectedTests } from "./affected-tests";
import { isVersionOnlyMetadataChange } from "./version-only-metadata";

const manifest = {
  name: "@asm/root",
  version: "1.0.0",
  scripts: { test: "bun test" },
};
const lock = {
  lockfileVersion: 1,
  workspaces: {
    "": { name: "@asm/root" },
    "apps/web": {
      name: "@asm/web",
      version: "1.0.0",
      dependencies: { example: "1.0.0" },
    },
  },
  packages: { example: ["example@1.0.0", "", {}, "checksum"] },
};

const changedLock = () => structuredClone(lock);

test("root release stamps preserve formatting-independent manifest equality", () => {
  expect(
    isVersionOnlyMetadataChange(
      "package.json",
      JSON.stringify(manifest),
      JSON.stringify({ ...manifest, version: "1.0.1" }, null, 2)
    )
  ).toBe(true);
  expect(
    isVersionOnlyMetadataChange(
      "package.json",
      JSON.stringify(manifest),
      JSON.stringify({ ...manifest, scripts: { test: "another runner" } })
    )
  ).toBe(false);
});

test("workspace version stamps in Bun's JSONC lockfile do not select unrelated tests", () => {
  const next = changedLock();
  next.workspaces["apps/web"].version = "1.0.1";
  const before = JSON.stringify(lock);
  const after = JSON.stringify(next).replace(
    '"lockfileVersion":1,',
    '"lockfileVersion":1, // Bun lockfile\n'
  );
  expect(isVersionOnlyMetadataChange("bun.lock", before, after)).toBe(true);
  const changed = ["apps/web/src/page.ts", "bun.lock"];
  const substantive = changed.filter(
    (filePath) =>
      !(
        filePath === "bun.lock" &&
        isVersionOnlyMetadataChange(filePath, before, after)
      )
  );
  expect(
    selectAffectedTests(
      substantive,
      ["apps/web/a.test.ts", "apps/mobile/b.test.ts"],
      [
        { directory: "apps/web", name: "@asm/web", dependencies: [] },
        { directory: "apps/mobile", name: "@asm/mobile", dependencies: [] },
      ]
    )
  ).toEqual(["apps/web/a.test.ts"]);
});

test("actual workspace dependency changes and package resolutions remain global changes", () => {
  const changedDependency = changedLock();
  changedDependency.workspaces["apps/web"].dependencies.example = "2.0.0";
  const changedResolution = changedLock();
  changedResolution.packages.example[0] = "example@2.0.0";
  expect(
    isVersionOnlyMetadataChange(
      "bun.lock",
      JSON.stringify(lock),
      JSON.stringify(changedDependency)
    )
  ).toBe(false);
  expect(
    isVersionOnlyMetadataChange(
      "bun.lock",
      JSON.stringify(lock),
      JSON.stringify(changedResolution)
    )
  ).toBe(false);
});

test("added workspaces and invalid or unknown formats retain the global fallback", () => {
  expect(
    isVersionOnlyMetadataChange(
      "bun.lock",
      JSON.stringify(lock),
      JSON.stringify({ ...lock, workspaces: {} })
    )
  ).toBe(false);
  expect(
    isVersionOnlyMetadataChange("bun.lock", "broken", JSON.stringify(lock))
  ).toBe(false);
  expect(isVersionOnlyMetadataChange("bun.lock", "{}", "{}")).toBe(false);
  expect(isVersionOnlyMetadataChange("unknown.json", "{}", "{}")).toBe(false);
});
