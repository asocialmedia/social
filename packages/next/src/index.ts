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

// Message media (and any other uploads) are served from the object-store
// endpoint. next/image needs the hostname allow-listed or image messages
// error out at runtime. Resolved at config load so the built image pins the
// host it was deployed with.
function asmobRemotePatterns(): { hostname: string; protocol: "https" }[] {
  try {
    const endpoint = process.env.ASMOB_ENDPOINT;
    if (!endpoint) {
      return [];
    }
    const { hostname, protocol } = new URL(endpoint);
    if (protocol !== "https:") {
      return [];
    }
    return [{ hostname, protocol: "https" }];
  } catch {
    return [];
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
      ...asmobRemotePatterns(),
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
