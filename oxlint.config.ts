import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import next from "ultracite/oxlint/next";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, next, react],
  globals: {
    Bun: "readonly",
  },
  ignorePatterns: [
    ...core.ignorePatterns,
    "scripts/**",
    "packages/db/prisma/migrations/**",
  ],
  overrides: [
    {
      files: ["packages/db/src/notification-type.ts"],
      rules: {
        "eslint/no-redeclare": "off",
      },
    },
    {
      files: ["packages/auth/src/core/prisma-adapter.ts"],
      rules: {
        "promise/prefer-await-to-callbacks": "off",
      },
    },
    {
      files: ["apps/media-processing/**", "packages/media/**"],
      rules: {
        "eslint/no-await-in-loop": "off",
        "eslint/no-bitwise": "off",
      },
    },
    {
      files: ["apps/web/src/app/api/users/avatar/**"],
      rules: {
        "eslint/no-await-in-loop": "off",
        "eslint/no-unused-vars": "off",
      },
    },
    {
      files: ["apps/mobile/metro.config.js"],
      rules: {
        "unicorn/prefer-module": "off",
      },
    },
    {
      files: ["apps/mobile/**"],
      rules: {
        "react/style-prop-object": "off",
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
