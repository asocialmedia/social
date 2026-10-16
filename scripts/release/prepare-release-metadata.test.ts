import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { generateReleaseNotesFile } from "./prepare-release-metadata";

describe("generateReleaseNotesFile", () => {
  let sandboxDir = "";

  beforeEach(async () => {
    sandboxDir = await mkdtemp(path.join(tmpdir(), "asm-release-meta-"));
    await writeFile(
      path.join(sandboxDir, "package.json"),
      `${JSON.stringify({ name: "@asocialmedia/social", version: "1.5.80" }, null, 2)}\n`
    );
  });

  afterEach(async () => {
    if (sandboxDir) {
      await rm(sandboxDir, { force: true, recursive: true });
      sandboxDir = "";
    }
  });

  const run = (env: Record<string, string | undefined>) =>
    generateReleaseNotesFile(
      sandboxDir,
      path.join(sandboxDir, "build-artifacts"),
      path.join(sandboxDir, "release-notes.md"),
      env
    );

  test("suffixes the release tag with the commit sha so a reused version cannot overwrite a release", async () => {
    const result = await run({ GITHUB_SHA: "abcdef1234567890" });

    expect(result.tagName).toBe("v1.5.80+abcdef1");
    expect(result.releaseTitle).toBe("v1.5.80");
  });

  test("falls back to the bare version when no commit sha is available", async () => {
    const result = await run({});

    expect(result.tagName).toBe("v1.5.80");
  });

  test("publishes the protocols image with its own app version", async () => {
    const appDirectory = path.join(sandboxDir, "apps/protocols");
    await mkdir(appDirectory, { recursive: true });
    await writeFile(
      path.join(appDirectory, "package.json"),
      JSON.stringify({ version: "0.1.7" })
    );
    const result = await run({
      GITHUB_REPOSITORY_OWNER: "asocialmedia",
      SELECTED_APPS: "protocols",
    });
    const notes = await readFile(result.notesPath, "utf8");
    expect(notes).toContain("ghcr.io/asocialmedia/asm-protocols");
    expect(notes).toContain("protocols-v0.1.7");
    expect(notes).not.toContain("protocols-v1.5.80");
  });
});
