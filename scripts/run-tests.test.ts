import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  endpointFromUrl,
  parseEnvFile,
  probeEndpoint,
  runTestSuite,
  type ServiceEndpoint,
} from "./run-tests";

describe("parseEnvFile", () => {
  test("parses plain and quoted values and skips comments", () => {
    const parsed = parseEnvFile(
      [
        "# a comment",
        "",
        "PLAIN=1",
        'QUOTED="postgres://u:p@localhost:5433/db"',
        "SINGLE='x'",
        "NO_SEPARATOR",
      ].join("\n")
    );

    expect(parsed).toEqual({
      PLAIN: "1",
      QUOTED: "postgres://u:p@localhost:5433/db",
      SINGLE: "x",
    });
  });
});

describe("endpointFromUrl", () => {
  test("extracts host and explicit port", () => {
    expect(
      endpointFromUrl("postgres", "postgresql://u:p@db.local:5433/app")
    ).toEqual({ host: "db.local", name: "postgres", port: 5433 });
  });

  test("falls back to service default ports", () => {
    expect(endpointFromUrl("redis", "redis://:pass@localhost/0")).toEqual({
      host: "localhost",
      name: "redis",
      port: 6379,
    });
    expect(
      endpointFromUrl("postgres", "postgresql://u:p@localhost/app")
    ).toEqual({
      host: "localhost",
      name: "postgres",
      port: 5432,
    });
  });

  test("returns undefined for missing or invalid urls", () => {
    expect(endpointFromUrl("redis", undefined)).toBeUndefined();
    expect(endpointFromUrl("redis", "")).toBeUndefined();
    expect(endpointFromUrl("redis", "not a url")).toBeUndefined();
    expect(
      endpointFromUrl("postgres", "postgresql://u:p@localhost:0/app")
    ).toBeUndefined();
  });
});

describe("probeEndpoint", () => {
  test("succeeds against a listening port", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const server = Bun.serve({
      fetch: () => new Response("ok"),
      port: 0,
    });
    const serverPort = server.port;

    if (serverPort === undefined) {
      throw new Error("Test server failed to allocate a port");
    }

    const reachable = await probeEndpoint(
      { host: "127.0.0.1", name: "redis", port: serverPort },
      1000
    );
    server.stop(true);
    resolve();

    await promise;
    expect(reachable).toBe(true);
  });

  test("fails against a closed port", async () => {
    const reachable = await probeEndpoint(
      { host: "127.0.0.1", name: "postgres", port: 1 },
      300
    );

    expect(reachable).toBe(false);
  });
});

describe("runTestSuite", () => {
  let sandbox = "";

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), "asm-run-tests-"));
  });

  afterEach(async () => {
    if (sandbox) {
      await rm(sandbox, { force: true, recursive: true });
      sandbox = "";
    }
  });

  function makeDeps(overrides: {
    allFiles: string[];
    servicesReachable?: boolean;
  }) {
    const invocations: {
      cmd: string[];
      cwd: string;
      env: Record<string, string | undefined>;
    }[] = [];
    const logger = { error: mock(() => {}), log: mock(() => {}) };

    return {
      deps: {
        collectFiles: () => Promise.resolve(overrides.allFiles),
        env: {},
        logger,
        probeService: (endpoint: ServiceEndpoint) =>
          Promise.resolve(overrides.servicesReachable ?? true),
        readEnvFile: () =>
          Promise.resolve(
            'DATABASE_URL="postgresql://u:p@db.local:5433/app"\nREDIS_URL="redis://:pass@redis.local/0"\n'
          ),
        rootDir: sandbox,
        runProcess: (options: {
          cmd: string[];
          cwd: string;
          env: Record<string, string | undefined>;
        }) => {
          invocations.push(options);
          return Promise.resolve(0);
        },
      } satisfies Parameters<typeof runTestSuite>[1],
      invocations,
      logger,
    };
  }

  test("fails when no test files exist", async () => {
    const { deps, logger } = makeDeps({ allFiles: [] });

    const exitCode = await runTestSuite([], deps);

    expect(exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith("No test files found.");
  });

  test("runs every test file in one parallel bun test invocation", async () => {
    const { deps, invocations } = makeDeps({
      allFiles: [
        "apps/auth/a.integration.test.ts",
        "apps/web/b.test.ts",
        "scripts/c.test.ts",
      ],
      servicesReachable: true,
    });

    const exitCode = await runTestSuite(["--bail=1"], deps);

    expect(exitCode).toBe(0);
    expect(invocations.length).toBe(1);
    expect(invocations[0]?.cmd).toEqual([
      "bun",
      "test",
      "--parallel",
      "--env-file=.env.test",
      "--timings=test-timings.json",
      "--update-timings",
      "--bail=1",
      "./apps/auth/a.integration.test.ts",
      "./apps/web/b.test.ts",
      "./scripts/c.test.ts",
    ]);
    expect(invocations[0]?.cwd).toBe(sandbox);
    expect(invocations[0]?.env.NODE_ENV).toBe("test");
  });

  test("skips integration tests when services are unreachable", async () => {
    const { deps, invocations, logger } = makeDeps({
      allFiles: [
        "apps/auth/a.integration.test.ts",
        "apps/web/b.test.ts",
        "scripts/c.test.ts",
      ],
      servicesReachable: false,
    });

    const exitCode = await runTestSuite([], deps);

    expect(exitCode).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Skipping integration tests")
    );
    expect(invocations.length).toBe(1);
    expect(invocations[0]?.cmd).toEqual([
      "bun",
      "test",
      "--parallel",
      "--env-file=.env.test",
      "--timings=test-timings.json",
      "--update-timings",
      "./apps/web/b.test.ts",
      "./scripts/c.test.ts",
    ]);
  });

  test("returns success when integration tests are the only files and services are down", async () => {
    const { deps, invocations, logger } = makeDeps({
      allFiles: ["apps/auth/a.integration.test.ts"],
      servicesReachable: false,
    });

    const exitCode = await runTestSuite([], deps);

    expect(exitCode).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      "No test files left to run after skipping integration tests."
    );
    expect(invocations.length).toBe(0);
  });

  test("skips integration tests when both service URLs are missing", async () => {
    const { deps, invocations, logger } = makeDeps({
      allFiles: ["apps/auth/a.integration.test.ts", "apps/web/b.test.ts"],
      servicesReachable: true,
    });

    const exitCode = await runTestSuite([], {
      ...deps,
      readEnvFile: () => Promise.resolve(""),
    });

    expect(exitCode).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("postgres and redis unreachable")
    );
    expect(invocations.length).toBe(1);
    expect(invocations[0]?.cmd).toEqual([
      "bun",
      "test",
      "--parallel",
      "--env-file=.env.test",
      "--timings=test-timings.json",
      "--update-timings",
      "./apps/web/b.test.ts",
    ]);
  });

  test("skips integration tests when exactly one service URL is missing", async () => {
    const { deps, invocations, logger } = makeDeps({
      allFiles: ["apps/auth/a.integration.test.ts", "apps/web/b.test.ts"],
      servicesReachable: true,
    });

    const exitCode = await runTestSuite([], {
      ...deps,
      readEnvFile: () =>
        Promise.resolve('DATABASE_URL="postgresql://u:p@db.local:5433/app"\n'),
    });

    expect(exitCode).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("redis unreachable")
    );
    expect(invocations.length).toBe(1);
    expect(invocations[0]?.cmd).toEqual([
      "bun",
      "test",
      "--parallel",
      "--env-file=.env.test",
      "--timings=test-timings.json",
      "--update-timings",
      "./apps/web/b.test.ts",
    ]);
  });

  test("prefers process env over env file for service urls", async () => {
    const { deps, invocations } = makeDeps({
      allFiles: ["apps/web/b.test.ts"],
    });

    await runTestSuite([], {
      ...deps,
      env: {
        DATABASE_URL: "postgresql://u:p@ci-db.local:5433/app",
        REDIS_URL: "redis://ci-redis.local/0",
      },
    });

    expect(invocations.length).toBe(1);
  });
});
