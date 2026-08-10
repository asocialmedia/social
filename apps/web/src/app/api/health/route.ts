import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    service: "asm-web",
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  });
}
