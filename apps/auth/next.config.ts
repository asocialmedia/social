import { loadRootEnv } from "@asm/next";
import type { NextConfig } from "next";

loadRootEnv();

const config: NextConfig = {
  allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  experimental: {
    cssChunking: true,
    staleTimes: { dynamic: 30 },
  },
  images: {
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

export default config;
