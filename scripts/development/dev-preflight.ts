#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { intro, log, outro, spinner } from "@clack/prompts";

import {
  buildPreflightProgressLine,
  buildRuntimeFingerprint,
  computeCacheDigest,
  DEFAULT_PREFLIGHT_CONFIG,
  getMissingBuckets,
  getMissingServices,
  getUnhealthyServices,
  hasClamAvDaemonCheck,
  hasOpenObserveHealth,
  hasRedisPong,
  hasSchemaTables,
  PREFLIGHT_CHECK_ORDER,
  parseServiceSnapshots,
  withinTtl,
} from "./dev-preflight-lib";
import type {
  CacheShape,
  PreflightCheckKey,
  PreflightCheckState,
  ServiceSnapshot,
} from "./dev-preflight-lib";
import { DEV_PORTS, killStaleDevProcesses } from "./kill-dev-ports";
import { postgresInspectionQuery } from "./postgres-inspection";

const CACHE_FILE = path.join(process.cwd(), ".cache", "dev-preflight.json");
const CACHE_TTL_MS = 20_000;
const CACHE_VERSION = 1;
const ASMOB_ACCESS_KEY = process.env.ASMOB_ROOT_USER ?? "asmob-admin";
const ASMOB_SECRET_KEY = process.env.ASMOB_ROOT_PASSWORD ?? "asmob-admin";
const ASMOB_REGION = process.env.ASMOB_REGION ?? "ap-south-1";
const ASMOB_INTERNAL_ENDPOINT = "http://asmob-dev:9000";

const checkStates = new Map<PreflightCheckKey, PreflightCheckState>(
  PREFLIGHT_CHECK_ORDER.map((item) => [item.key, "pending"])
);

const activeChecks = new Set<PreflightCheckKey>();
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
  for (const key of activeChecks) {
    setCheckState(key, "failed");
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

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

async function ensureCacheDir() {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
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

async function runCheck(
  cache: CacheShape,
  key: PreflightCheckKey,
  checkInput: string,
  fn: () => Promise<void>
) {
  activeChecks.add(key);
  setCheckState(key, "running");
  try {
    const status = await withCache(cache, key, checkInput, fn);
    setCheckState(key, status);
  } finally {
    activeChecks.delete(key);
  }
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

  return parseServiceSnapshots(result.stdout);
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

// Verifies the host-side TCP listener exists. Container healthchecks pass
// even when the pasta port forward is dead, which is exactly how a fully
// "green" preflight left dev servers with ECONNREFUSED.
async function assertHostPortReady(port: number, label: string) {
  if (!(await hasListenerOnPort(port))) {
    fatal(
      `${label} is not reachable on localhost:${port}. The container may be healthy but its port forward is stale - recreate it with 'podman rm -f <container> && bun run docker:dev'.`
    );
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
    postgresInspectionQuery("schemaReady"),
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

async function assertOpenObserveReady() {
  const result = await runCmd([
    "curl",
    "-sS",
    "-f",
    "http://localhost:5080/healthz",
  ]);

  if (result.exitCode !== 0 || !hasOpenObserveHealth(result.stdout)) {
    fatal(`OpenObserve check failed: ${result.stderr || result.stdout}`);
  }
}

async function assertClamAvReady() {
  // Uses the image's own clamdcheck.sh so the check exercises the exact
  // PING path the compose healthcheck and the media worker rely on.\
  const result = await runCmd([
    "docker",
    "compose",
    "-f",
    "docker/docker-compose.dev.yml",
    "exec",
    "-T",
    "clamav-dev",
    "clamdcheck.sh",
  ]);

  if (!hasClamAvDaemonCheck(result.exitCode)) {
    fatal(
      `ClamAV check failed: ${result.stderr || result.stdout || "clamd did not answer PING"}`
    );
  }
}

async function hasListenerOnPort(port: number) {
  const result = await runCmd(["ss", "-ltnH", `sport = :${port}`]);
  if (result.exitCode !== 0) {
    fatal(`Port check failed for :${port}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim().length > 0;
}

async function getComposeFileFingerprint() {
  const composePath = path.join(
    process.cwd(),
    "docker",
    "docker-compose.dev.yml"
  );
  const [content, fileStat] = await Promise.all([
    readFile(composePath, "utf-8"),
    stat(composePath),
  ]);

  return hash(
    `${fileStat.mtimeMs}:${content.length}:${content.slice(0, 2048)}`
  );
}

async function cleanupStaleDevServers() {
  // Free all dev ports (3000 web, 3001 auth, 3010 media-processing health, 3012 protocols)
  // and terminate any orphaned dev processes and locks.
  await killStaleDevProcesses(DEV_PORTS);
}

async function run() {
  // Single-instance guarantee: clean up orphans before any checks or servers start.
  await cleanupStaleDevServers();

  intro("asmdev preflight");
  renderProgress();

  let snapshots: ServiceSnapshot[] = [];
  let cache: CacheShape;
  let composeFingerprint = "";
  let runtimeFingerprint = "";

  activeChecks.add("services");
  setCheckState("services", "running");
  [snapshots, composeFingerprint, cache] = await Promise.all([
    getServiceSnapshot(),
    getComposeFileFingerprint(),
    getCache(),
  ]);
  runtimeFingerprint = buildRuntimeFingerprint(snapshots);

  if (cache.version !== CACHE_VERSION) {
    cache.version = CACHE_VERSION;
    cache.checks = {};
  }

  const servicesStatus = await withCache(
    cache,
    "services",
    composeFingerprint,
    async () => {
      assertServicesHealthy(snapshots);
    }
  );
  setCheckState("services", servicesStatus);

  const checks: {
    checkInput: string;
    fn: () => Promise<void>;
    key: PreflightCheckKey;
  }[] = [
    {
      checkInput: runtimeFingerprint,
      fn: async () => {
        await assertHostPortReady(5433, "Postgres");
        await assertPostgresSchemaReady();
      },
      key: "postgres",
    },
    {
      checkInput: runtimeFingerprint,
      fn: async () => {
        await assertHostPortReady(6379, "Redis");
        await assertRedisReady();
      },
      key: "redis",
    },
    {
      checkInput: runtimeFingerprint,
      fn: async () => {
        await assertHostPortReady(9000, "Object storage (ASMOB)");
        await assertBucketsReady();
      },
      key: "asmob",
    },
    {
      checkInput: runtimeFingerprint,
      fn: async () => {
        await assertHostPortReady(5080, "OpenObserve");
        await assertOpenObserveReady();
      },
      key: "openobserve",
    },
    {
      checkInput: runtimeFingerprint,
      fn: async () => {
        await assertHostPortReady(3310, "ClamAV");
        await assertClamAvReady();
      },
      key: "clamav",
    },
  ];

  for (const check of checks) {
    // oxlint-disable-next-line no-await-in-loop -- sequential check order matches progress indicator
    await runCheck(cache, check.key, check.checkInput, check.fn);
  }

  await setCache(cache);
  finishProgressLine();
  outro("Preflight checks passed");
}

if (import.meta.main) {
  await run();
}
