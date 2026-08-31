import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { collectTestFiles } from "./test-file-discovery";
import type { TestScope } from "./test-file-discovery";

type CoverageScope = TestScope;

const COVERAGE_CONFIG_PATH = path.join("scripts", "bunfig.coverage.toml");
const COVERAGE_DIR_PREFIX = 'coverageDir = "';

function isCoverageScope(value: string): value is CoverageScope {
  return value === "all" || value === "unit" || value === "integration";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseCoverageDir(configContents: string): string {
  const line = configContents
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(COVERAGE_DIR_PREFIX));

  if (!line) {
    throw new Error(`Missing coverageDir in ${COVERAGE_CONFIG_PATH}`);
  }

  return line.slice(COVERAGE_DIR_PREFIX.length, line.lastIndexOf('"'));
}

async function getSourceLcovPath(deps: CoverageRunnerDeps): Promise<string> {
  const readText = deps.readText ?? defaultReadText;
  const coverageConfig = await readText(COVERAGE_CONFIG_PATH);
  const coverageDir = parseCoverageDir(coverageConfig);

  return path.join(coverageDir, "lcov.info");
}

interface CoverageRunnerDeps {
  collectFiles?: typeof collectTestFiles;
  fileExists?: (filePath: string) => Promise<boolean>;
  logger?: Pick<typeof console, "error" | "log">;
  readText?: (filePath: string) => Promise<string>;
  removeFile?: (filePath: string) => Promise<void>;
  runProcess?: (args: string[]) => Promise<number>;
  writeText?: (filePath: string, content: string) => Promise<void>;
}

interface LcovFileRecord {
  functions: Map<string, { hits: number; line: number }>;
  lines: Map<number, number>;
}

function createLcovRecord(): LcovFileRecord {
  return {
    functions: new Map<string, { hits: number; line: number }>(),
    lines: new Map<number, number>(),
  };
}

function upsertRecord(
  map: Map<string, LcovFileRecord>,
  filePath: string
): LcovFileRecord {
  const existing = map.get(filePath);
  if (existing) {
    return existing;
  }

  const created = createLcovRecord();
  map.set(filePath, created);
  return created;
}

function parseFnLine(line: string):
  | {
      lineNumber: number;
      name: string;
    }
  | undefined {
  const payload = line.slice(3);
  const separatorIndex = payload.indexOf(",");
  if (separatorIndex === -1) {
    return;
  }

  const lineNumber = Number(payload.slice(0, separatorIndex));
  if (!Number.isFinite(lineNumber)) {
    return;
  }

  const name = payload.slice(separatorIndex + 1);
  if (name.length === 0) {
    return;
  }

  return { lineNumber, name };
}

function parseFndaLine(line: string):
  | {
      hits: number;
      name: string;
    }
  | undefined {
  const payload = line.slice(5);
  const separatorIndex = payload.indexOf(",");
  if (separatorIndex === -1) {
    return;
  }

  const hits = Number(payload.slice(0, separatorIndex));
  if (!Number.isFinite(hits)) {
    return;
  }

  const name = payload.slice(separatorIndex + 1);
  if (name.length === 0) {
    return;
  }

  return { hits, name };
}

function parseDaLine(line: string):
  | {
      lineNumber: number;
      hits: number;
    }
  | undefined {
  const payload = line.slice(3);
  const separatorIndex = payload.indexOf(",");
  if (separatorIndex === -1) {
    return;
  }

  const lineNumber = Number(payload.slice(0, separatorIndex));
  if (!Number.isFinite(lineNumber)) {
    return;
  }

  const hits = Number(payload.slice(separatorIndex + 1));
  if (!Number.isFinite(hits)) {
    return;
  }

  return { hits, lineNumber };
}

function applyFnLine(record: LcovFileRecord, line: string): void {
  const parsed = parseFnLine(line);
  if (!parsed) {
    return;
  }

  const current = record.functions.get(parsed.name);
  record.functions.set(parsed.name, {
    hits: current?.hits ?? 0,
    line: parsed.lineNumber,
  });
}

function applyFndaLine(record: LcovFileRecord, line: string): void {
  const parsed = parseFndaLine(line);
  if (!parsed) {
    return;
  }

  const current = record.functions.get(parsed.name);
  record.functions.set(parsed.name, {
    hits: Math.max(current?.hits ?? 0, parsed.hits),
    line: current?.line ?? 0,
  });
}

function applyDaLine(record: LcovFileRecord, line: string): void {
  const parsed = parseDaLine(line);
  if (!parsed) {
    return;
  }

  record.lines.set(
    parsed.lineNumber,
    Math.max(record.lines.get(parsed.lineNumber) ?? 0, parsed.hits)
  );
}

function defaultRunProcess(args: string[]): Promise<number> {
  const proc = Bun.spawn({
    cmd: ["bun", `--config=${COVERAGE_CONFIG_PATH}`, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  return proc.exited;
}

async function defaultWriteText(
  filePath: string,
  content: string
): Promise<void> {
  await writeFile(filePath, content, "utf-8");
}

async function defaultReadText(filePath: string): Promise<string> {
  return await readFile(filePath, "utf-8");
}

async function defaultRemoveFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

async function writeMergedLcov(
  scope: CoverageScope,
  chunks: string[],
  deps: CoverageRunnerDeps = {}
): Promise<void> {
  const targetDir = path.join("coverage", scope);
  const targetPath = path.join(targetDir, "lcov.info");
  const writeText = deps.writeText ?? defaultWriteText;

  await mkdir(targetDir, { recursive: true });

  if (chunks.length === 0) {
    await writeText(targetPath, "TN:\n");
    return;
  }

  const records = mergeLcovChunks(chunks);
  const merged = serializeLcovRecords(records);

  await writeText(targetPath, merged);
}

function parseLcovChunk(chunk: string): Map<string, LcovFileRecord> {
  const byFile = new Map<string, LcovFileRecord>();
  const lines = chunk.split("\n");
  let currentFile = "";

  for (const line of lines) {
    if (line.startsWith("SF:")) {
      currentFile = line.slice(3);
      upsertRecord(byFile, currentFile);
      continue;
    }

    if (!currentFile) {
      continue;
    }

    const record = upsertRecord(byFile, currentFile);

    if (line.startsWith("FN:")) {
      applyFnLine(record, line);
      continue;
    }

    if (line.startsWith("FNDA:")) {
      applyFndaLine(record, line);
      continue;
    }

    if (line.startsWith("DA:")) {
      applyDaLine(record, line);
    }
  }

  return byFile;
}

function mergeLcovChunks(chunks: string[]): Map<string, LcovFileRecord> {
  const merged = new Map<string, LcovFileRecord>();

  for (const chunk of chunks) {
    const parsed = parseLcovChunk(chunk);

    for (const [filePath, record] of parsed) {
      const target = upsertRecord(merged, filePath);

      for (const [lineNumber, hits] of record.lines) {
        target.lines.set(
          lineNumber,
          Math.max(target.lines.get(lineNumber) ?? 0, hits)
        );
      }

      for (const [name, fn] of record.functions) {
        const current = target.functions.get(name);
        target.functions.set(name, {
          hits: Math.max(current?.hits ?? 0, fn.hits),
          line: current?.line || fn.line,
        });
      }
    }
  }

  return merged;
}

function serializeLcovRecords(records: Map<string, LcovFileRecord>): string {
  if (records.size === 0) {
    return "TN:\n";
  }

  const output: string[] = [];
  const files = [...records.keys()].toSorted((a, b) => a.localeCompare(b));

  for (const filePath of files) {
    const record = records.get(filePath);
    if (!record) {
      continue;
    }

    const functionEntries = [...record.functions.entries()].toSorted((a, b) =>
      a[0].localeCompare(b[0])
    );
    const lineEntries = [...record.lines.entries()].toSorted(
      (a, b) => a[0] - b[0]
    );

    output.push("TN:", `SF:${filePath}`);

    for (const [name, fn] of functionEntries) {
      if (fn.line > 0) {
        output.push(`FN:${fn.line},${name}`);
      }
    }

    for (const [name, fn] of functionEntries) {
      output.push(`FNDA:${fn.hits},${name}`);
    }

    const functionHitCount = functionEntries.filter(
      ([, fn]) => fn.hits > 0
    ).length;
    output.push(`FNF:${functionEntries.length}`, `FNH:${functionHitCount}`);

    for (const [lineNumber, hits] of lineEntries) {
      output.push(`DA:${lineNumber},${hits}`);
    }

    const lineHitCount = lineEntries.filter(([, hits]) => hits > 0).length;
    output.push(
      `LF:${lineEntries.length}`,
      `LH:${lineHitCount}`,
      "end_of_record"
    );
  }

  return `${output.join("\n")}\n`;
}

export async function runCoverageForScope(
  scope: CoverageScope,
  deps: CoverageRunnerDeps = {}
): Promise<number> {
  const collectFiles = deps.collectFiles ?? collectTestFiles;
  const doesFileExist = deps.fileExists ?? fileExists;
  const logger = deps.logger ?? console;
  const readText = deps.readText ?? defaultReadText;
  const removeFile = deps.removeFile ?? defaultRemoveFile;
  const runProcess = deps.runProcess ?? defaultRunProcess;
  const sourceLcovPath = await getSourceLcovPath(deps);

  const coverageArgs = [
    "--parallel",
    "--timings=test-timings.json",
    "--coverage",
    "--coverage-reporter=text",
    "--coverage-reporter=lcov",
  ];

  const testFiles = await collectFiles(scope);

  if (testFiles.length === 0) {
    await writeMergedLcov(scope, [], deps);

    if (scope === "integration") {
      logger.log("No integration tests found. Skipping integration coverage.");
      return 0;
    }

    logger.error(`No tests found for ${scope} scope.`);
    return 1;
  }

  await removeFile(sourceLcovPath);

  const exitCode = await runProcess([
    "test",
    "--env-file=.env.test",
    ...coverageArgs,
    ...testFiles.map((filePath) => `./${filePath}`),
  ]);

  const hasLcov = await doesFileExist(sourceLcovPath);

  if (!hasLcov) {
    logger.error(`Coverage output missing: ${sourceLcovPath}`);
    await writeMergedLcov(scope, [], deps);
    return exitCode === 0 ? 1 : exitCode;
  }

  const lcovContent = await readText(sourceLcovPath);
  await writeMergedLcov(scope, [lcovContent], deps);

  return exitCode;
}

export async function runCoverageCli(
  args = Bun.argv.slice(2)
): Promise<number> {
  const [scopeInput] = args;

  const usage =
    "Usage: bun scripts/run-coverage-suite.ts [all|unit|integration]";
  if (scopeInput !== undefined && isCoverageScope(scopeInput) === false) {
    console.error(usage);
    return 1;
  }

  return await runCoverageForScope(scopeInput ?? "all");
}

const isDirectExecution = Bun.argv.some(
  (arg) =>
    arg.endsWith("scripts/run-coverage-suite.ts") ||
    arg.endsWith("run-coverage-suite.ts")
);

if (isDirectExecution) {
  (async () => {
    try {
      const exitCode = await runCoverageCli();
      process.exit(exitCode);
    } catch (error: unknown) {
      console.error("Failed to run coverage suite:", error);
      process.exit(1);
    }
  })();
}
