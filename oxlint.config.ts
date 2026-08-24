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
      files: ["apps/web/src/**/*.{ts,tsx}"],
      rules: {
        "react/exhaustive-effect-dependencies": "warn",
        "react/incompatible-library": "warn",
        "react/memo-dependencies": "warn",
        "react/no-deriving-state-in-effects": "warn",
        "react/refs": "warn",
        "react/set-state-in-effect": "warn",
        "react/static-components": "warn",
        "react/todo": "warn",
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
