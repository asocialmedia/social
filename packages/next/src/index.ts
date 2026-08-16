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
  // Cache Components: the App Router default in a future major. Prerenders a
  // static shell per route (PPR), makes `use cache`/`cacheLife` available, and
  // turns data fetching dynamic-by-default. This is the foundation for instant
  // client-side navigation.
  cacheComponents: true,
  experimental: {
    // Cache subsets of a route seeded from actual navigations so subsequent
    // visits to the same or similar pages are served instantly.
    cachedNavigations: true,
    cssChunking: true,
    // Route handlers that read runtime data (session headers) bail out of
    // prerendering; their catch blocks log the bail-out as noise during build.
    hideLogsAfterAbort: true,
    // Client-router cache lifetimes: auto-prefetched (dynamic) RSC payloads
    // are reused for 30s so repeated navigation stays instant, and explicitly
    // prefetched static routes stay cached for 5m.
    staleTimes: { dynamic: 30, static: 300 },
    // Use the Rust port of the React Compiler for faster builds (Turbopack only,
    // which is the default bundler in Next 16.3).
    turbopackRustReactCompiler: true,
    // Let the browser serve cached/prefetched routes when the network drops.
    useOffline: true,
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
  // Partial Prefetching: prefetch one reusable per-route shell (not one request
  // per link), cached per-session on the client, so navigations resolve the
  // shell instantly like an SPA. Requires cacheComponents.
  partialPrefetching: true,
  reactCompiler: true,
  reactStrictMode: true,
  transpilePackages: ["@asm/auth", "@asm/db", "@asm/config"],
};

export const withStreamConfig = (sourceConfig: NextConfig): NextConfig => ({
  ...sourceConfig,
});
