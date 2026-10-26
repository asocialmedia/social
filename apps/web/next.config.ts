import { config, withStreamConfig } from "@asm/next";
import type { NextConfig } from "@asm/next";

const nextConfig: NextConfig = withStreamConfig({
  ...config,
  deploymentId: process.env.NEXT_DEPLOYMENT_ID,
  distDir: process.env.ASM_NEXT_DIST_DIR ?? config.distDir,
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
  rewrites() {
    return {
      afterFiles: [
        {
          destination: "/.well-known/indexnow/:keyTxt",
          source: "/:keyTxt([A-Za-z0-9-]+\\.txt)",
        },
      ],
    };
  },
});

export default nextConfig;
