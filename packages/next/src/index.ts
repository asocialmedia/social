import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

export function loadRootEnv(): void {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      loadEnv({ path: candidate, quiet: true, override: true });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

export const config: NextConfig = {
  transpilePackages: ["@asm/auth", "@asm/db", "@asm/config"],
  reactStrictMode: true,
  reactCompiler: true,
  allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  experimental: {
    staleTimes: { dynamic: 30 },
    cssChunking: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "styles.redditmedia.com" },
    ],
    qualities: [100, 75],
    unoptimized: process.env.NODE_ENV === "development",
  },
};

export const withStreamConfig = (sourceConfig: NextConfig): NextConfig => ({
  ...sourceConfig,
});
