import { describe, expect, mock, test } from "bun:test";

import { runUnitTests } from "./run-unit-tests";

describe("run-unit-tests", () => {
  test("fails when no unit tests exist", async () => {
    const logger = { error: mock(() => {}) };

    const exitCode = await runUnitTests([], {
      collectFiles: () => Promise.resolve([]),
      logger,
      rootDir: "/tmp/repo",
      runProcess: () => Promise.resolve(0),
    });

    expect(exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith("No unit tests found.");
  });

  test("runs each unit test file and stops on first non-zero exit", async () => {
    const invocations: string[][] = [];

    const exitCode = await runUnitTests(["--bail=1"], {
      collectFiles: () =>
        Promise.resolve([
          "apps/auth/a.test.ts",
          "packages/db/b.test.ts",
          "scripts/c.test.ts",
        ]),
      rootDir: "/tmp/repo",
      runProcess: ({ cmd }) => {
        invocations.push(cmd);
        return Promise.resolve(invocations.length === 2 ? 7 : 0);
      },
    });

    expect(exitCode).toBe(7);
    expect(invocations).toEqual([
      [
        "bun",
        "test",
        "--env-file=.env.test",
        "--bail=1",
        "./apps/auth/a.test.ts",
      ],
      [
        "bun",
        "test",
        "--env-file=.env.test",
        "--bail=1",
        "./packages/db/b.test.ts",
      ],
    ]);
  });

  test("returns success when all unit files pass", async () => {
    const invocations: string[][] = [];

    const exitCode = await runUnitTests([], {
      collectFiles: () =>
        Promise.resolve(["apps/auth/a.test.ts", "packages/db/b.test.ts"]),
      rootDir: "/tmp/repo",
      runProcess: ({ cmd, env, cwd }) => {
        invocations.push(cmd);
        expect(cwd).toBe("/tmp/repo");
        expect(env.NODE_ENV).toBe("test");
        return Promise.resolve(0);
      },
    });

    expect(exitCode).toBe(0);
    expect(invocations.length).toBe(2);
  });
});
