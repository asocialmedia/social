import { config, withStreamConfig } from "@asm/next";
import type { NextConfig } from "@asm/next";

// eslint-disable-next-line eslint/sort-keys -- Keep app overrides together after the shared config.
const nextConfig: NextConfig = withStreamConfig({
  ...config,
  deploymentId: process.env.NEXT_DEPLOYMENT_ID,
  // The floating badge overlaps the sidebar theme control and mobile dock.
  devIndicators: false,
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
  transpilePackages: [...(config.transpilePackages ?? []), "@asm/messages"],
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
