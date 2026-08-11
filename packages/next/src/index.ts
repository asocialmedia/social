import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

export function loadRootEnv(): void {
  loadEnv({
    path: join(process.cwd(), ".env"),
    quiet: true,
  });
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
    unoptimized: process.env.NODE_ENV === "development",
  },
};

export const withStreamConfig = (sourceConfig: NextConfig): NextConfig => ({
  ...sourceConfig,
});
