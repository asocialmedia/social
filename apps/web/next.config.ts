import { config, withStreamConfig } from "@asm/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = withStreamConfig({
  ...config,
  headers() {
    return [
      {
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
        source: "/_next/static/media/:path*",
      },
      {
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
        source: "/feed.xml",
      },
    ];
  },
});

export default nextConfig;
