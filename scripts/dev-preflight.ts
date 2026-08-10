#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { intro, log, outro, spinner } from "@clack/prompts";
import {
  areInitJobsComplete,
  buildPreflightProgressLine,
  buildRuntimeFingerprint,
  type CacheShape,
  computeCacheDigest,
  DEFAULT_PREFLIGHT_CONFIG,
  getMissingBuckets,
  getMissingServices,
  getUnhealthyServices,
  hasRedisPong,
  hasSchemaTables,
  type OneShotStatus,
  PREFLIGHT_CHECK_ORDER,
  type PreflightCheckKey,
  type PreflightCheckState,
  type ServiceSnapshot,
  shouldUseSudoForPortless,
  withinTtl,
} from "./dev-preflight-lib";

const CACHE_FILE = join(process.cwd(), ".cache", "dev-preflight.json");
const CACHE_TTL_MS = 20_000;
const CACHE_VERSION = 1;
const ASMOB_ACCESS_KEY = process.env.ASMOB_ROOT_USER ?? "asmob-admin";
const ASMOB_SECRET_KEY = process.env.ASMOB_ROOT_PASSWORD ?? "asmob-admin";
const ASMOB_REGION = process.env.ASMOB_REGION ?? "ap-south-1";
const ASMOB_INTERNAL_ENDPOINT = "http://asmob-dev:9000";

const checkStates = new Map<PreflightCheckKey, PreflightCheckState>(
  PREFLIGHT_CHECK_ORDER.map((item) => [item.key, "pending"])
);

let activeCheck: PreflightCheckKey | null = null;
const progressSpinner = process.stdout.isTTY ? spinner() : null;
let progressSpinnerStarted = false;

function renderProgress() {
  const line = buildPreflightProgressLine(checkStates);

  if (!progressSpinner) {
    process.stdout.write(`${line}\n`);
    return;
  }

  if (!progressSpinnerStarted) {
    progressSpinner.start(line);
    progressSpinnerStarted = true;
    return;
  }

  progressSpinner.message(line);
}

function setCheckState(key: PreflightCheckKey, state: PreflightCheckState) {
  checkStates.set(key, state);
  renderProgress();
}

function finishProgressLine() {
  if (progressSpinner && progressSpinnerStarted) {
    progressSpinner.stop(buildPreflightProgressLine(checkStates));
    progressSpinnerStarted = false;
  }
}

function fatal(message: string): never {
  if (activeCheck) {
    setCheckState(activeCheck, "failed");
  }
  finishProgressLine();
  log.error(message);
  outro("Preflight failed. Start infra with `bun run docker:dev` and retry.");
  process.exit(1);
}

async function runCmd(args: string[]) {
  const proc = Bun.spawn(args, {
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    exitCode,
    stderr: stderr.trim(),
    stdout: stdout.trim(),
  };
}

async function runInteractiveCmd(args: string[]) {
  const proc = Bun.spawn(args, {
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  return {
    exitCode: await proc.exited,
  };
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

async function ensureCacheDir() {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
}

function getCache(): Promise<CacheShape> {
  return readJsonFile<CacheShape>(CACHE_FILE, {
    checks: {},
    version: CACHE_VERSION,
  });
}

async function setCache(cache: CacheShape) {
  await ensureCacheDir();
  await writeFile(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
}

function hash(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

async function withCache(
  cache: CacheShape,
  key: string,
  checkInput: string,
  fn: () => Promise<void>
) {
  const digest = computeCacheDigest(checkInput);
  const hit = cache.checks[key];

  if (hit && hit.key === digest && withinTtl(hit.timestamp, CACHE_TTL_MS)) {
    return "cached" as const;
  }

  await fn();
  cache.checks[key] = {
    key: digest,
    timestamp: Date.now(),
  };
  return "ok" as const;
}

async function getServiceSnapshot() {
  const result = await runCmd([
    "docker",
    "compose",
    "-f",
    "docker/docker-compose.dev.yml",
    "ps",
    "--format",
    "json",
  ]);

  if (result.exitCode !== 0) {
    fatal(`Docker compose status failed: ${result.stderr || "unknown error"}`);
  }

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const snapshots = lines.map((line) => JSON.parse(line) as ServiceSnapshot);
  return snapshots;
}

async function getOneShotStatus(containerName: string): Promise<OneShotStatus> {
  const result = await runCmd([
    "docker",
    "ps",
    "-a",
    "--filter",
    `name=${containerName}`,
    "--format",
    "{{.Status}}",
  ]);

  if (result.exitCode !== 0) {
    fatal(
      `Failed to inspect ${containerName} state: ${result.stderr || result.stdout}`
    );
  }

  if (!result.stdout) {
    return { exists: false, status: "" };
  }

  return {
    exists: true,
    status: result.stdout.split("\n")[0]?.trim() || "",
  };
}

function assertServicesHealthy(snapshots: ServiceSnapshot[]) {
  const missing = getMissingServices(
    snapshots,
    DEFAULT_PREFLIGHT_CONFIG.requiredServices
  );
  if (missing.length > 0) {
    fatal(`Missing required services: ${missing.join(", ")}`);
  }

  const unhealthy = getUnhealthyServices(
    snapshots,
    DEFAULT_PREFLIGHT_CONFIG.requiredServices
  );

  if (unhealthy.length > 0) {
    fatal(`Unhealthy services: ${unhealthy.join(", ")}`);
  }
}

async function assertPostgresSchemaReady() {
  const validate = await runCmd([
    "docker",
    "compose",
    "-f",
    "docker/docker-compose.dev.yml",
    "exec",
    "-T",
    "postgres-dev",
    "psql",
    "-U",
    "postgres",
    "-d",
    "asocialmedia",
    "-At",
    "-c",
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE');",
  ]);

  if (validate.exitCode !== 0) {
    fatal(
      `Postgres schema check failed: ${validate.stderr || validate.stdout}`
    );
  }

  if (!hasSchemaTables(validate.stdout)) {
    fatal("Postgres schema is not initialized (no public tables found)");
  }
}

async function assertRedisReady() {
  const result = await runCmd([
    "docker",
    "compose",
    "-f",
    "docker/docker-compose.dev.yml",
    "exec",
    "-T",
    "redis-dev",
    "redis-cli",
    "-a",
    "asmredis",
    "PING",
  ]);

  if (result.exitCode !== 0 || !hasRedisPong(result.stdout)) {
    fatal(
      `Redis check failed: ${result.stderr || result.stdout || "no response"}`
    );
  }
}

async function assertBucketsReady() {
  const list = await runCmd([
    "docker",
    "run",
    "--rm",
    "--network",
    "asmdev-network",
    "-e",
    `AWS_ACCESS_KEY_ID=${ASMOB_ACCESS_KEY}`,
    "-e",
    `AWS_SECRET_ACCESS_KEY=${ASMOB_SECRET_KEY}`,
    "-e",
    `AWS_DEFAULT_REGION=${ASMOB_REGION}`,
    "amazon/aws-cli:2.17.53",
    "s3api",
    "list-buckets",
    "--endpoint-url",
    ASMOB_INTERNAL_ENDPOINT,
    "--query",
    "Buckets[].Name",
    "--output",
    "json",
  ]);

  if (list.exitCode !== 0) {
    fatal(`Object storage check failed: ${list.stderr || list.stdout}`);
  }

  const bucketNames = JSON.parse(list.stdout) as string[];
  const missing = getMissingBuckets(
    bucketNames,
    DEFAULT_PREFLIGHT_CONFIG.requiredBuckets
  );

  if (missing.length > 0) {
    fatal(`Missing object storage buckets: ${missing.join(", ")}`);
  }
}

async function assertInitJobsCompleted() {
  const [schemaInit, objectInit] = await Promise.all([
    getOneShotStatus("asmdev-schema-init"),
    getOneShotStatus("asmdev-asmob-init"),
  ]);

  if (!areInitJobsComplete(schemaInit, objectInit)) {
    if (!schemaInit.exists) {
      fatal("Schema init job has not been created yet (asmdev-schema-init)");
    }
    if (!objectInit.exists) {
      fatal(
        "Object storage init job has not been created yet (asmdev-asmob-init)"
      );
    }
    if (!schemaInit.status.startsWith("Exited (0)")) {
      fatal(
        `Schema init job is not complete: ${schemaInit.status || "unknown"}`
      );
    }
    fatal(
      `Object storage init job is not complete: ${objectInit.status || "unknown"}`
    );
  }
}

async function assertMeilisearchReady() {
  const result = await runCmd([
    "curl",
    "-sS",
    "-f",
    "http://localhost:7700/health",
  ]);

  if (result.exitCode !== 0) {
    fatal(`Meilisearch check failed: ${result.stderr || result.stdout}`);
  }
}

async function hasListenerOnPort(port: number) {
  const result = await runCmd(["ss", "-ltnH", `sport = :${port}`]);
  if (result.exitCode !== 0) {
    fatal(`Port check failed for :${port}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim().length > 0;
}

async function ensurePortlessProxyReady() {
  if (await hasListenerOnPort(443)) {
    return;
  }

  if (await hasListenerOnPort(1355)) {
    await runCmd(["portless", "proxy", "stop"]);
  }

  let startResult = await runCmd([
    "portless",
    "proxy",
    "start",
    "--https",
    "--port",
    "443",
  ]);

  if (startResult.exitCode !== 0) {
    const output = `${startResult.stdout}\n${startResult.stderr}`;
    const needsSudo = shouldUseSudoForPortless(output);

    if (needsSudo && process.stdin.isTTY) {
      const sudoStartResult = await runInteractiveCmd([
        "sudo",
        "portless",
        "proxy",
        "start",
        "--https",
        "--port",
        "443",
      ]);

      if (sudoStartResult.exitCode !== 0) {
        fatal("Portless proxy failed to start on port 443.");
      }

      startResult = { exitCode: 0, stderr: "", stdout: "" };
    }
  }

  if (startResult.exitCode !== 0) {
    fatal(
      "Portless proxy is not ready on port 443. Run `sudo portless proxy start --https --port 443` and retry."
    );
  }

  if (!(await hasListenerOnPort(443))) {
    fatal(
      "Portless proxy did not bind to port 443. Run `sudo portless proxy start --https --port 443` and retry."
    );
  }
}

async function getComposeFileFingerprint() {
  const composePath = join(process.cwd(), "docker", "docker-compose.dev.yml");
  const [content, fileStat] = await Promise.all([
    readFile(composePath, "utf8"),
    stat(composePath),
  ]);

  return hash(
    `${fileStat.mtimeMs}:${content.length}:${content.slice(0, 2048)}`
  );
}

async function run() {
  intro("asmdev preflight");
  renderProgress();

  let snapshots: ServiceSnapshot[] = [];
  let composeFingerprint = "";
  let runtimeFingerprint = "";

  activeCheck = "services";
  setCheckState("services", "running");
  snapshots = await getServiceSnapshot();
  composeFingerprint = await getComposeFileFingerprint();
  runtimeFingerprint = buildRuntimeFingerprint(snapshots);

  const cache = await getCache();
  if (cache.version !== CACHE_VERSION) {
    cache.version = CACHE_VERSION;
    cache.checks = {};
  }

  const servicesStatus = await withCache(
    cache,
    "services",
    `${composeFingerprint}:${runtimeFingerprint}`,
    () => {
      assertServicesHealthy(snapshots);
      return Promise.resolve();
    }
  );
  setCheckState("services", servicesStatus);
  activeCheck = null;

  activeCheck = "init-jobs";
  setCheckState("init-jobs", "running");
  const initJobsStatus = await withCache(
    cache,
    "init-jobs",
    `${composeFingerprint}:${runtimeFingerprint}`,
    () => assertInitJobsCompleted()
  );
  setCheckState("init-jobs", initJobsStatus);
  activeCheck = null;

  activeCheck = "postgres";
  setCheckState("postgres", "running");
  const postgresStatus = await withCache(
    cache,
    "postgres",
    `${composeFingerprint}:${runtimeFingerprint}`,
    () => assertPostgresSchemaReady()
  );
  setCheckState("postgres", postgresStatus);
  activeCheck = null;

  activeCheck = "redis";
  setCheckState("redis", "running");
  const redisStatus = await withCache(
    cache,
    "redis",
    `${composeFingerprint}:${runtimeFingerprint}`,
    () => assertRedisReady()
  );
  setCheckState("redis", redisStatus);
  activeCheck = null;

  activeCheck = "asmob";
  setCheckState("asmob", "running");
  const asmobStatus = await withCache(
    cache,
    "asmob",
    `${composeFingerprint}:${runtimeFingerprint}:${ASMOB_ACCESS_KEY}:${ASMOB_REGION}`,
    () => assertBucketsReady()
  );
  setCheckState("asmob", asmobStatus);
  activeCheck = null;

  activeCheck = "meilisearch";
  setCheckState("meilisearch", "running");
  const meilisearchStatus = await withCache(
    cache,
    "meilisearch",
    `${composeFingerprint}:${runtimeFingerprint}`,
    () => assertMeilisearchReady()
  );
  setCheckState("meilisearch", meilisearchStatus);
  activeCheck = null;

  activeCheck = "portless";
  setCheckState("portless", "running");
  await ensurePortlessProxyReady();
  setCheckState("portless", "ok");
  activeCheck = null;

  await setCache(cache);
  finishProgressLine();
  log.success("Asocialmedia goes brr");
  outro("Preflight checks passed");
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fatal(message);
});
