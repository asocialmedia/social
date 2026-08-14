import { config, withStreamConfig } from "@asm/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = withStreamConfig({ ...config });

export default nextConfig;
