import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // Prisma emits these content-addressed contracts; formatting them adds work and rewrites generated artifacts.
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "packages/db/prisma/migrations/snapshots/**",
  ],
});
