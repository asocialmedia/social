import nextra from "nextra";

const withNextra = nextra({
  // ... Add Nextra-specific options here
});

export default withNextra({
  allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@asm/ui", "@asm/config"],
  turbopack: {
    resolveAlias: {
      "next-mdx-import-source-file": "./src/mdx-components.js",
    },
  },
});
