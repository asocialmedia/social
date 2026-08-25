import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import next from "ultracite/oxlint/next";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, next, react],
  globals: {
    Bun: "readonly",
  },
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      // Media-processing manipulates binary formats (bitstream hashing,
      // waveform views, pixel packing) where bitwise operators are the
      // domain language, and its job loops are ordered on purpose: ffmpeg
      // ladders and S3 uploads run sequentially to bound CPU/memory. The
      // shared media package earns the same exemption for its container
      // parsers (JPEG/PNG/WebP metadata stripping walk byte structures).
      files: ["apps/media-processing/**", "packages/media/**"],
      rules: {
        "eslint/no-await-in-loop": "off",
        "eslint/no-bitwise": "off",
      },
    },
  ],
  rules: {
    complexity: "off",
    "func-style": "off",
    "no-console": "off",
    "no-inline-comments": "off",
    "no-use-before-define": "off",
    "react/function-component-definition": "off",
    "react/no-unescaped-entities": "off",
    "require-unicode-regexp": "off",
  },
});
