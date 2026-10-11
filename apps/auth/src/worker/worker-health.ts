import { readFile, rename, unlink, writeFile } from "node:fs/promises";

export const WORKER_HEALTH_MAX_AGE_MS = 30_000;
export type WorkerHealthService = "message-search-worker" | "worker";

export function workerHealthPath(service: WorkerHealthService): string {
  return process.env.WORKER_HEALTH_PATH ?? `/tmp/asm-${service}-health.json`;
}

export async function writeWorkerHealth(
  path: string,
  service: WorkerHealthService,
  now = Date.now()
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      JSON.stringify({ lastHeartbeatAt: now, pid: process.pid, service }),
      { mode: 0o600 }
    );
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => {
      /* empty */
    });
  }
}

export async function clearWorkerHealth(path: string): Promise<void> {
  await unlink(path).catch(() => {
    /* empty */
  });
}

export async function checkWorkerHealth(
  path: string,
  service: WorkerHealthService,
  now = Date.now()
): Promise<boolean> {
  try {
    const serialized = await readFile(path, "utf-8");
    if (serialized.length > 1024) {
      return false;
    }
    const state: unknown = JSON.parse(serialized);
    if (typeof state !== "object" || state === null) {
      return false;
    }
    const value = state as Record<string, unknown>;
    if (
      value.service !== service ||
      typeof value.pid !== "number" ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      typeof value.lastHeartbeatAt !== "number" ||
      !Number.isFinite(value.lastHeartbeatAt)
    ) {
      return false;
    }
    const age = now - value.lastHeartbeatAt;
    if (age < 0 || age >= WORKER_HEALTH_MAX_AGE_MS) {
      return false;
    }
    process.kill(value.pid, 0);
    return true;
  } catch {
    return false;
  }
}
