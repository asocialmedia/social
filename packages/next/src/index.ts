import { existsSync } from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

export function loadRootEnv(): void {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      loadEnv({ override: true, path: candidate, quiet: true });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

export const config: NextConfig = {
  allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  experimental: {
    cssChunking: true,
    staleTimes: { dynamic: 30 },
  },
  images: {
    qualities: [100, 75],
    remotePatterns: [
      { hostname: "lh3.googleusercontent.com", protocol: "https" },
      { hostname: "avatars.githubusercontent.com", protocol: "https" },
      { hostname: "cdn.discordapp.com", protocol: "https" },
      { hostname: "pbs.twimg.com", protocol: "https" },
      { hostname: "styles.redditmedia.com", protocol: "https" },
    ],
    unoptimized: process.env.NODE_ENV === "development",
  },
  reactCompiler: true,
  reactStrictMode: true,
  transpilePackages: ["@asm/auth", "@asm/db", "@asm/config"],
};

export const withStreamConfig = (sourceConfig: NextConfig): NextConfig => ({
  ...sourceConfig,
});
