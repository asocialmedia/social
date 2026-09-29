import { describe, expect, test } from "bun:test";

import { $ } from "bun";

// Mirrors how Bun surfaces a failed command, so the classification under test is
// driven by the real shape rather than a hand-built stand-in. Bun puts only
// "Failed with exit code 1" in `message` and the command's own output on
// `stderr`; a fake that pasted the diagnostic into `message` would pass while
// the real retry never fired.
async function failLikeGradle(stderr: string, exitCode = 1) {
  try {
    await $`sh -c ${`printf '%s' ${JSON.stringify(stderr)} >&2; exit ${exitCode}`}`;
  } catch (error) {
    return error;
  }
  throw new Error("expected the command to fail");
}

const RESOLUTION_ERROR =
  "FAILURE: Build failed with an exception.\n" +
  "* What went wrong:\n" +
  "Plugin [id: 'org.gradle.toolchains.foojay-resolver-convention', version: '1.0.0'] " +
  "was not found in any of the following sources:\n" +
  "- Gradle Core Plugins (plugin is not in 'org.gradle' namespace)";

describe("a failed gradle command", () => {
  test("keeps gradle's diagnostic on stderr, not in the message", async () => {
    // Documents the reason the classifier has to read stderr at all. If Bun ever
    // folds the output into the message this test fails and the extra handling
    // can be revisited.
    const error = await failLikeGradle(RESOLUTION_ERROR);
    const failure = error as { message?: string; stderr?: unknown };
    expect(failure.message).toBe("Failed with exit code 1");
    expect(String(failure.stderr)).toContain("was not found in any of the");
  });
});

// Kept in step with build-android-apk.ts. The classifier is re-declared here
// rather than exported from the script, because the script runs a build on
// import; if the two drift, this file is the one to update.
const GRADLE_RESOLUTION_FAILURE =
  /was not found in any of the following sources|could not resolve (?:plugin artifact|all files|.*artifact)/i;

function classify(error: unknown): boolean {
  const failure = error as {
    message?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };
  const text = [failure.message, failure.stderr, failure.stdout]
    .map((part) =>
      typeof part === "string" || Buffer.isBuffer(part) ? part.toString() : ""
    )
    .join("\n");
  return GRADLE_RESOLUTION_FAILURE.test(text);
}

describe("retry classification", () => {
  test("matches a plugin-portal resolution failure", async () => {
    expect(classify(await failLikeGradle(RESOLUTION_ERROR))).toBe(true);
  });

  test("matches a dependency that could not be resolved", async () => {
    const error = await failLikeGradle(
      "Could not resolve all files for configuration ':classpath'."
    );
    expect(classify(error)).toBe(true);
  });

  test("does not match a real compile error", async () => {
    const error = await failLikeGradle(
      "e: file.kt:12:5 Unresolved reference: foo\n> Task :app:compileReleaseKotlin FAILED"
    );
    expect(classify(error)).toBe(false);
  });

  test("does not match a signing or keystore failure", async () => {
    const error = await failLikeGradle(
      "Keystore was tampered with, or password was incorrect"
    );
    expect(classify(error)).toBe(false);
  });

  test("does not match a lint failure", async () => {
    const error = await failLikeGradle(
      "Could not find method lint() for arguments"
    );
    expect(classify(error)).toBe(false);
  });
});
