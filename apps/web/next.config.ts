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
      // Native passkey association files must parse as JSON on-device.
      {
        headers: [
          {
            key: "Content-Type",
            value: "application/json",
          },
        ],
        source: "/.well-known/apple-app-site-association",
      },
      {
        headers: [
          {
            key: "Content-Type",
            value: "application/json",
          },
        ],
        source: "/.well-known/assetlinks.json",
      },
    ];
  },
});

export default nextConfig;
