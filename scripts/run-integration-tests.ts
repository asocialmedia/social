import { collectTestFiles } from "./test-file-discovery";

interface IntegrationTestRunnerDeps {
  collectFiles?: typeof collectTestFiles;
  logger?: Pick<typeof console, "error" | "log">;
  rootDir?: string;
  runProcess?: (options: { cmd: string[]; cwd: string }) => Promise<number>;
}

function defaultRunProcess(options: {
  cmd: string[];
  cwd: string;
}): Promise<number> {
  const proc = Bun.spawn({
    cmd: options.cmd,
    cwd: options.cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  return proc.exited;
}

export async function runIntegrationTests(
  extraArgs = Bun.argv.slice(2),
  deps: IntegrationTestRunnerDeps = {}
): Promise<number> {
  const rootDir = deps.rootDir ?? process.cwd();
  const logger = deps.logger ?? console;
  const collectFiles = deps.collectFiles ?? collectTestFiles;
  const runProcess = deps.runProcess ?? defaultRunProcess;
  const integrationTests = await collectFiles("integration", rootDir);

  if (integrationTests.length === 0) {
    logger.log("No integration tests found. Skipping integration suite.");
    return 0;
  }

  return await runProcess({
    cmd: [
      "bun",
      "test",
      "--env-file=.env.test",
      ...extraArgs,
      ...integrationTests.map((filePath) => `./${filePath}`),
    ],
    cwd: rootDir,
  });
}

const isDirectExecution = Bun.argv.some(
  (arg) =>
    arg.endsWith("scripts/run-integration-tests.ts") ||
    arg.endsWith("run-integration-tests.ts")
);

if (isDirectExecution) {
  (async () => {
    try {
      const exitCode = await runIntegrationTests();
      process.exit(exitCode);
    } catch (error: unknown) {
      console.error("Failed to execute integration tests:", error);
      process.exit(1);
    }
  })();
}
