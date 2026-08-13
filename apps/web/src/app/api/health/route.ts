import { redis } from "@asm/db";
import { NextResponse } from "next/server";

const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
const WORKER_STALE_MS = 25_000;

export async function GET() {
  let worker: "healthy" | "unhealthy" | "unknown" = "unknown";
  try {
    const heartbeat = await redis.get(WORKER_HEARTBEAT_KEY);
    if (heartbeat) {
      const age = Date.now() - Number.parseInt(heartbeat, 10);
      worker =
        Number.isNaN(age) || age > WORKER_STALE_MS ? "unhealthy" : "healthy";
    }
  } catch {
    worker = "unknown";
  }

  return NextResponse.json({
    service: "asm-web",
    status: "healthy",
    worker,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  });
}
