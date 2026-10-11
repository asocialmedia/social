import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  checkWorkerHealth,
  clearWorkerHealth,
  WORKER_HEALTH_MAX_AGE_MS,
  writeWorkerHealth,
} from "./worker-health";

let directory: string;
let healthPath: string;
const now = 1_700_000_000_000;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "asm-worker-health-test-"));
  healthPath = path.join(directory, "health.json");
});
afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe("per-process worker health", () => {
  test("accepts an atomic, fresh heartbeat from the expected running process", async () => {
    await writeWorkerHealth(healthPath, "message-search-worker", now);
    expect(
      await checkWorkerHealth(healthPath, "message-search-worker", now + 1000)
    ).toBe(true);
    expect(await readdir(directory)).toEqual(["health.json"]);
    const fileState = await stat(healthPath);
    expect(fileState.mode % 512).toBe(0o600);
  });

  test("rejects expired, future and different-service heartbeats", async () => {
    await writeWorkerHealth(healthPath, "message-search-worker", now);
    expect(
      await checkWorkerHealth(
        healthPath,
        "message-search-worker",
        now + WORKER_HEALTH_MAX_AGE_MS
      )
    ).toBe(false);
    expect(
      await checkWorkerHealth(healthPath, "message-search-worker", now - 1)
    ).toBe(false);
    expect(await checkWorkerHealth(healthPath, "worker", now)).toBe(false);
  });

  test("rejects dead processes and malformed or oversized health files", async () => {
    for (const state of [
      "{",
      "null",
      "[]",
      "x".repeat(1025),
      JSON.stringify({
        lastHeartbeatAt: now,
        pid: 2_147_483_647,
        service: "message-search-worker",
      }),
      JSON.stringify({
        lastHeartbeatAt: now,
        pid: -1,
        service: "message-search-worker",
      }),
      JSON.stringify({
        lastHeartbeatAt: "now",
        pid: process.pid,
        service: "message-search-worker",
      }),
    ]) {
      // eslint-disable-next-line no-await-in-loop -- each invalid file replaces the previous probe input
      await writeFile(healthPath, state);
      // eslint-disable-next-line no-await-in-loop -- probe the current invalid file before replacing it
      const healthy = await checkWorkerHealth(
        healthPath,
        "message-search-worker",
        now
      );
      expect(healthy).toBe(false);
    }
  });

  test("missing files and repeated shutdown cleanup are harmless", async () => {
    expect(
      await checkWorkerHealth(healthPath, "message-search-worker", now)
    ).toBe(false);
    await clearWorkerHealth(healthPath);
    await writeWorkerHealth(healthPath, "message-search-worker", now);
    await clearWorkerHealth(healthPath);
    await clearWorkerHealth(healthPath);
    expect(
      await checkWorkerHealth(healthPath, "message-search-worker", now)
    ).toBe(false);
  });

  test("a failed heartbeat write leaves no temporary artifact", async () => {
    await expect(
      writeWorkerHealth(
        path.join(directory, "missing", "health.json"),
        "worker",
        now
      )
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});

describe("health probe entry point", () => {
  async function probe(role: string, binary?: string) {
    const child = Bun.spawn(
      binary
        ? [binary, "--health-check"]
        : [
            process.execPath,
            path.join(import.meta.dirname, "../worker.ts"),
            "--health-check",
          ],
      {
        cwd: directory,
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/invalid",
          MESSAGE_SEARCH_WORKER_ONLY: role,
          NODE_ENV: "production",
          REDIS_URL: "redis://127.0.0.1:1",
          WORKER_HEALTH_PATH: healthPath,
        },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      return code;
    } finally {
      clearTimeout(timeout);
    }
  }

  test("the compiled production entry point probes health without evaluating service clients", async () => {
    const binary = path.join(directory, "worker");
    const build = Bun.spawn(
      [
        process.execPath,
        "build",
        "--compile",
        "--minify",
        "--external",
        "msgpackr-extract",
        path.join(import.meta.dirname, "../worker.ts"),
        "--outfile",
        binary,
      ],
      {
        cwd: path.join(import.meta.dirname, "../../../.."),
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [code, stderr] = await Promise.all([
      build.exited,
      new Response(build.stderr).text(),
      new Response(build.stdout).text(),
    ]);
    expect(code, stderr).toBe(0);
    await writeWorkerHealth(healthPath, "message-search-worker");
    expect(await probe("1", binary)).toBe(0);
    await clearWorkerHealth(healthPath);
    expect(await probe("1", binary)).toBe(1);
  }, 15_000);

  test("succeeds with no environment file or reachable dependencies", async () => {
    await writeWorkerHealth(healthPath, "message-search-worker");
    expect(await probe("1")).toBe(0);
  });

  test("fails for a stale process-local heartbeat without starting queues", async () => {
    await writeWorkerHealth(
      healthPath,
      "message-search-worker",
      Date.now() - WORKER_HEALTH_MAX_AGE_MS
    );
    expect(await probe("1")).toBe(1);
  });

  test("the general worker cannot use the dedicated service heartbeat", async () => {
    await writeWorkerHealth(healthPath, "message-search-worker");
    expect(await probe("0")).toBe(1);
    await writeWorkerHealth(healthPath, "worker");
    expect(await probe("0")).toBe(0);
  });
});
