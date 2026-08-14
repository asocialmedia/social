import { describe, expect, mock, test } from "bun:test";

import { runIntegrationTests } from "./run-integration-tests";

describe("run-integration-tests", () => {
  test("returns success and logs when no integration tests exist", async () => {
    const logger = {
      error: mock(() => {}),
      log: mock(() => {}),
    };

    const exitCode = await runIntegrationTests([], {
      collectFiles: () => Promise.resolve([]),
      logger,
      rootDir: "/tmp/repo",
      runProcess: () => Promise.resolve(9),
    });

    expect(exitCode).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      "No integration tests found. Skipping integration suite."
    );
  });

  test("runs all integration tests in one bun test invocation", async () => {
    const calls: { cmd: string[]; cwd: string }[] = [];

    const exitCode = await runIntegrationTests(["--bail=1"], {
      collectFiles: () =>
        Promise.resolve([
          "apps/auth/a.integration.test.ts",
          "scripts/b.integration.test.ts",
        ]),
      rootDir: "/tmp/repo",
      runProcess: ({ cmd, cwd }) => {
        calls.push({ cmd, cwd });
        return Promise.resolve(0);
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      {
        cmd: [
          "bun",
          "test",
          "--env-file=.env.test",
          "--bail=1",
          "./apps/auth/a.integration.test.ts",
          "./scripts/b.integration.test.ts",
        ],
        cwd: "/tmp/repo",
      },
    ]);
  });

  test("propagates non-zero process exit code", async () => {
    const exitCode = await runIntegrationTests([], {
      collectFiles: () => Promise.resolve(["apps/auth/a.integration.test.ts"]),
      rootDir: "/tmp/repo",
      runProcess: () => Promise.resolve(17),
    });

    expect(exitCode).toBe(17);
  });
});
