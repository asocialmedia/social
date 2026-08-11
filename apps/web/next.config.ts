import { config, loadRootEnv, withStreamConfig } from "@asm/next";
import type { NextConfig } from "next";

loadRootEnv();

let nextConfig: NextConfig = { ...config };

nextConfig = withStreamConfig(nextConfig);

export default nextConfig;
