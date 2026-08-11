import { config, withStreamConfig } from "@asm/next";
import type { NextConfig } from "next";

let nextConfig: NextConfig = { ...config };

nextConfig = withStreamConfig(nextConfig);

export default nextConfig;
