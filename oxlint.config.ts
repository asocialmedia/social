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
