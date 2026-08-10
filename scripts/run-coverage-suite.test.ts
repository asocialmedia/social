import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCoverageCli, runCoverageForScope } from "./run-coverage-suite";

const originalConsoleError = console.error;

describe("run-coverage-suite", () => {
  let originalCwd = "";
  let sandbox = "";

  beforeEach(async () => {
    console.error = mock(() => undefined) as typeof console.error;
    sandbox = await mkdtemp(join(tmpdir(), "asm-run-coverage-suite-"));
    originalCwd = process.cwd();
    process.chdir(sandbox);

    await mkdir(join(sandbox, "scripts"), { recursive: true });
    await writeFile(
      join(sandbox, "scripts", "bunfig.coverage.toml"),
      '[test]\ncoverageDir = "coverage/all"\n',
      "utf8"
    );
    await mkdir(join(sandbox, "coverage", "all"), { recursive: true });
  });

  afterEach(async () => {
    console.error = originalConsoleError;
    process.chdir(originalCwd);
    if (sandbox) {
      await rm(sandbox, { force: true, recursive: true });
      sandbox = "";
    }
  });

  test("returns success for empty integration scope and writes placeholder lcov", async () => {
    const logger = { error: mock(() => undefined), log: mock(() => undefined) };

    const exitCode = await runCoverageForScope("integration", {
      collectFiles: async () => [],
      logger,
      removeFile: async () => undefined,
      runProcess: async () => 1,
      writeText: async () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      "No integration tests found. Skipping integration coverage."
    );
  });

  test("fails non-integration scopes with no tests", async () => {
    const logger = { error: mock(() => undefined), log: mock(() => undefined) };

    const exitCode = await runCoverageForScope("unit", {
      collectFiles: async () => [],
      logger,
      removeFile: async () => undefined,
      runProcess: async () => 0,
      writeText: async () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith("No tests found for unit scope.");
  });

  test("merges lcov chunks across files and returns success", async () => {
    const calls: string[][] = [];
    const writes = new Map<string, string>();

    const exitCode = await runCoverageForScope("unit", {
      collectFiles: async () => [
        "apps/auth/src/a.test.ts",
        "scripts/b.test.ts",
      ],
      fileExists: async (filePath) =>
        filePath.endsWith("coverage/all/lcov.info"),
      readText: (filePath) => {
        if (filePath.endsWith("scripts/bunfig.coverage.toml")) {
          return Promise.resolve('[test]\ncoverageDir = "coverage/all"\n');
        }

        return Promise.resolve(
          "TN:\nSF:a.ts\nDA:1,1\nend_of_record\nTN:\nSF:b.ts\nDA:1,1\nend_of_record\n"
        );
      },
      removeFile: (filePath) => {
        expect(filePath).toBe("coverage/all/lcov.info");
        return Promise.resolve();
      },
      runProcess: (args) => {
        calls.push(args);
        return Promise.resolve(0);
      },
      writeText: (filePath, content) => {
        writes.set(filePath, content);
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls).toEqual([
      [
        "test",
        "--env-file=.env.test",
        "--coverage",
        "--coverage-reporter=text",
        "--coverage-reporter=lcov",
        "./apps/auth/src/a.test.ts",
        "./scripts/b.test.ts",
      ],
    ]);

    const merged = writes.get("coverage/unit/lcov.info");
    expect(merged).toContain("SF:a.ts");
    expect(merged).toContain("SF:b.ts");
    expect(merged).toContain("FNF:0");
  });

  test("deduplicates lcov records by file and function", async () => {
    const writes = new Map<string, string>();

    const exitCode = await runCoverageForScope("unit", {
      collectFiles: async () => [
        "apps/auth/src/a.test.ts",
        "apps/auth/src/a2.test.ts",
      ],
      fileExists: async () => true,
      readText: (filePath) => {
        if (filePath.endsWith("scripts/bunfig.coverage.toml")) {
          return Promise.resolve('[test]\ncoverageDir = "coverage/all"\n');
        }

        return Promise.resolve(
          [
            "TN:",
            "SF:apps/auth/src/a.ts",
            "FN:1,foo",
            "FNDA:0,foo",
            "DA:1,0",
            "DA:2,1",
            "end_of_record",
            "TN:",
            "SF:apps/auth/src/a.ts",
            "FN:1,foo",
            "FNDA:3,foo",
            "DA:1,3",
            "DA:2,0",
            "end_of_record",
          ].join("\n")
        );
      },
      removeFile: async () => undefined,
      runProcess: async () => 0,
      writeText: (filePath, content) => {
        writes.set(filePath, content);
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(0);
    const merged = writes.get("coverage/unit/lcov.info") ?? "";
    expect(merged).toContain("SF:apps/auth/src/a.ts");
    expect(merged).toContain("FNDA:3,foo");
    expect(merged).toContain("DA:1,3");
    expect(merged).toContain("DA:2,1");
    expect(merged).toContain("FNF:1");
    expect(merged).toContain("FNH:1");
    expect(merged).toContain("LF:2");
    expect(merged).toContain("LH:2");
  });

  test("writes partial lcov and returns failing exit code", async () => {
    const writes = new Map<string, string>();

    const exitCode = await runCoverageForScope("unit", {
      collectFiles: async () => [
        "apps/auth/src/a.test.ts",
        "scripts/b.test.ts",
      ],
      fileExists: async () => true,
      readText: (filePath) => {
        if (filePath.endsWith("scripts/bunfig.coverage.toml")) {
          return Promise.resolve('[test]\ncoverageDir = "coverage/all"\n');
        }

        return Promise.resolve(
          "TN:\nSF:a.ts\nDA:1,1\nend_of_record\nTN:\nSF:b.ts\nDA:1,1\nend_of_record\n"
        );
      },
      removeFile: async () => undefined,
      runProcess: async () => 3,
      writeText: (filePath, content) => {
        writes.set(filePath, content);
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(3);
    const merged = writes.get("coverage/unit/lcov.info");
    expect(merged).toContain("SF:a.ts");
    expect(merged).toContain("SF:b.ts");
  });

  test("returns 1 when lcov file is missing after success", async () => {
    const writes = new Map<string, string>();
    const logger = { error: mock(() => undefined), log: mock(() => undefined) };

    const exitCode = await runCoverageForScope("unit", {
      collectFiles: async () => ["apps/auth/src/a.test.ts"],
      fileExists: async () => false,
      logger,
      readText: (filePath) => {
        if (filePath.endsWith("scripts/bunfig.coverage.toml")) {
          return Promise.resolve('[test]\ncoverageDir = "coverage/all"\n');
        }
        return Promise.resolve("");
      },
      removeFile: async () => undefined,
      runProcess: async () => 0,
      writeText: (filePath, content) => {
        writes.set(filePath, content);
        return Promise.resolve();
      },
    });

    expect(exitCode).toBe(1);
    expect(writes.get("coverage/unit/lcov.info")).toContain("TN:\n");
    expect(logger.error).toHaveBeenCalledWith(
      "Coverage output missing: coverage/all/lcov.info"
    );
  });

  test("runCoverageCli validates arguments", async () => {
    const noArg = await runCoverageCli([]);
    const badArg = await runCoverageCli(["oops"]);

    expect(noArg).toBe(1);
    expect(badArg).toBe(1);
  });
});
