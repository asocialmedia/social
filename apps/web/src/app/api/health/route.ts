import { redis } from "@asm/db";
import { NextResponse } from "next/server";

const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
const MESSAGE_SEARCH_WORKER_HEARTBEAT_KEY = "worker:message-search:heartbeat";
const WORKER_STALE_MS = 25_000;

async function readWorkerHealth(
  key: string
): Promise<"healthy" | "unhealthy" | "unknown"> {
  try {
    const heartbeat = await redis.get(key);
    if (!heartbeat) {
      return "unknown";
    }
    const age = Date.now() - Math.trunc(Number(heartbeat));
    return Number.isNaN(age) || age > WORKER_STALE_MS ? "unhealthy" : "healthy";
  } catch {
    return "unknown";
  }
}

export async function GET() {
  const [worker, messageSearchWorker] = await Promise.all([
    readWorkerHealth(WORKER_HEARTBEAT_KEY),
    readWorkerHealth(MESSAGE_SEARCH_WORKER_HEARTBEAT_KEY),
  ]);

  return NextResponse.json({
    messageSearchWorker,
    service: "asm-web",
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    worker,
  });
}
