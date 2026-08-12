import type { NextConfig } from "next";

const config: NextConfig = {
  allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  experimental: {
    staleTimes: { dynamic: 30 },
  },
  reactCompiler: true,
  reactStrictMode: true,
  transpilePackages: ["@asm/auth", "@asm/db", "@asm/config"],
};

export default config;
