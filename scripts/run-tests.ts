import { connect } from "node:net";
import path from "node:path";

import { collectTestFiles, isIntegrationTestFile } from "./test-file-discovery";

const ENV_FILE_NAME = ".env.test";
const TIMINGS_FILE_NAME = "test-timings.json";

export type ServiceName = "postgres" | "redis";

export interface ServiceEndpoint {
  host: string;
  name: ServiceName;
  port: number;
}

const SERVICE_DEFAULT_PORTS: Record<ServiceName, number> = {
  postgres: 5432,
  redis: 6379,
};

// Env overrides used to resolve service endpoints (DATABASE_URL, REDIS_URL).
// Defaults to process.env so CI-provided URLs win over .env.test.
interface RunTestSuiteDeps {
  collectFiles?: typeof collectTestFiles;
  env?: Record<string, string | undefined>;
  logger?: Pick<typeof console, "error" | "log">;
  probeService?: (endpoint: ServiceEndpoint) => Promise<boolean>;
  readEnvFile?: (filePath: string) => Promise<string | undefined>;
  rootDir?: string;
  runProcess?: (options: {
    cmd: string[];
    cwd: string;
    env: Record<string, string | undefined>;
  }) => Promise<number>;
}

export function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);

    if (isQuoted) {
      value = value.slice(1, -1);
    }

    if (key) {
      parsed[key] = value;
    }
  }

  return parsed;
}

export function endpointFromUrl(
  name: ServiceName,
  rawUrl: string | undefined
): ServiceEndpoint | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);
    const port = url.port ? Number(url.port) : SERVICE_DEFAULT_PORTS[name];

    if (!url.hostname || !Number.isFinite(port) || port <= 0) {
      return undefined;
    }

    return { host: url.hostname, name, port };
  } catch {
    return undefined;
  }
}

export function probeEndpoint(
  endpoint: ServiceEndpoint,
  timeoutMs = 1500
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: endpoint.host, port: endpoint.port });

    const finish = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function defaultRunProcess(options: {
  cmd: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}): Promise<number> {
  const proc = Bun.spawn({
    cmd: options.cmd,
    cwd: options.cwd,
    env: options.env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  return proc.exited;
}

async function defaultReadEnvFile(
  filePath: string
): Promise<string | undefined> {
  const file = Bun.file(filePath);

  if (await file.exists()) {
    return await file.text();
  }

  return undefined;
}

export async function runTestSuite(
  extraArgs = Bun.argv.slice(2),
  deps: RunTestSuiteDeps = {}
): Promise<number> {
  const rootDir = deps.rootDir ?? process.cwd();
  const logger = deps.logger ?? console;
  const collectFiles = deps.collectFiles ?? collectTestFiles;
  const runProcess = deps.runProcess ?? defaultRunProcess;
  const probeService = deps.probeService ?? probeEndpoint;
  const readEnvFile = deps.readEnvFile ?? defaultReadEnvFile;
  const processEnv = deps.env ?? process.env;

  const allTests = await collectFiles("all", rootDir);

  if (allTests.length === 0) {
    logger.error("No test files found.");
    return 1;
  }

  const envFileText = await readEnvFile(path.join(rootDir, ENV_FILE_NAME));
  const envValues = {
    ...parseEnvFile(envFileText ?? ""),
    ...processEnv,
  };

  const endpoints = [
    endpointFromUrl("postgres", envValues.DATABASE_URL),
    endpointFromUrl("redis", envValues.REDIS_URL),
  ].filter((endpoint): endpoint is ServiceEndpoint => endpoint !== undefined);

  const probeResults = await Promise.all(endpoints.map(probeService));
  const servicesReachable = probeResults.every((reachable) => reachable);

  let selectedTests = allTests;

  if (!servicesReachable) {
    const unreachableNames = endpoints
      .filter((_endpoint, index) => !probeResults[index])
      .map((endpoint) => endpoint.name)
      .join(" and ");
    logger.log(
      `Skipping integration tests: ${unreachableNames || "required services"} unreachable (start the dev services to include them).`
    );
    selectedTests = allTests.filter(
      (filePath) => !isIntegrationTestFile(filePath)
    );

    if (selectedTests.length === 0) {
      logger.log("No test files left to run after skipping integration tests.");
      return 0;
    }
  }

  return await runProcess({
    cmd: [
      "bun",
      "test",
      "--parallel",
      `--env-file=${ENV_FILE_NAME}`,
      `--timings=${TIMINGS_FILE_NAME}`,
      "--update-timings",
      ...extraArgs,
      ...selectedTests.map((filePath) => `./${filePath}`),
    ],
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });
}

const isDirectExecution = Bun.argv.some(
  (arg) => arg.endsWith("scripts/run-tests.ts") || arg.endsWith("run-tests.ts")
);

if (isDirectExecution) {
  (async () => {
    try {
      const exitCode = await runTestSuite();
      process.exit(exitCode);
    } catch (error: unknown) {
      console.error("Failed to execute test suite:", error);
      process.exit(1);
    }
  })();
}
